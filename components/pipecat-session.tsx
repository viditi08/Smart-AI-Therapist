"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { springBouncy } from "@/lib/motion-presets";
import {
  saveConversation,
  type SavedChatMessage,
} from "@/lib/session-history-storage";

const backend =
  process.env.NEXT_PUBLIC_PIPECAT_BACKEND_URL ?? "http://127.0.0.1:7860";

type Stage = "idle" | "connecting" | "listening" | "speaking";

export function PipecatSession() {
  const [stage, setStage] = useState<Stage>("idle");
  const [messages, setMessages] = useState<SavedChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const clientRef = useRef<PipecatClient | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = stage === "listening" || stage === "speaking";

  const lastYou = [...messages].reverse().find((m) => m.role === "user")?.text;
  const lastEmma = [...messages].reverse().find((m) => m.role === "emma")?.text;

  const release = useCallback(() => {
    generation.current += 1;
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    client?.enableMic(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    void client?.disconnect().catch(() => {});
  }, []);

  useEffect(() => release, [release]);

  const stop = useCallback(() => {
    release();
    setStage("idle");
  }, [release]);

  const append = (role: SavedChatMessage["role"], text: string) => {
    if (!text.trim()) return;
    setMessages((previous) => {
      const last = previous.at(-1);
      if (last?.role === role) {
        return [
          ...previous.slice(0, -1),
          { ...last, text: `${last.text} ${text}` },
        ];
      }
      return [...previous, { id: crypto.randomUUID(), role, text }];
    });
  };

  async function start() {
    if (clientRef.current) return;
    release();
    const run = generation.current;
    const current = () => generation.current === run;
    setError(null);
    setSessionSummary(null);
    setStage("connecting");
    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
      if (!current()) return;
      stop();
      setError(
        "Connection timed out. Start the Pipecat backend and check your provider keys.",
      );
    }, 30000);
    try {
      const response = await fetch(`${backend}/health`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("The Pipecat voice backend is unavailable.");
      const health = (await response.json()) as {
        ready: boolean;
        missing: string[];
      };
      if (!health.ready) {
        throw new Error(
          `Configure voice-backend/.env: ${health.missing.join(", ")}`,
        );
      }
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import("@pipecat-ai/client-js"),
        import("@pipecat-ai/small-webrtc-transport"),
      ]);
      if (!current()) return;
      const client = new PipecatClient({
        transport: new SmallWebRTCTransport({
          iceServers: [],
          waitForICEGathering: true,
        }),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onBotReady: () => {
            if (!current()) return;
            if (timerRef.current) clearTimeout(timerRef.current);
            setStage("listening");
          },
          onDisconnected: () => {
            if (current()) stop();
          },
          onError: () => {
            if (current()) {
              stop();
              setError(
                "Voice connection failed. Check provider keys, model access, and quota.",
              );
            }
          },
          onTrackStarted: (track, participant) => {
            if (!current() || participant?.local || track.kind !== "audio") return;
            const audio = audioRef.current;
            if (audio) {
              audio.srcObject = new MediaStream([track]);
              void audio.play().catch(() => {
                if (current()) {
                  setError("Press play on the audio control to hear Emma.");
                }
              });
            }
          },
          onBotStartedSpeaking: () => {
            if (current()) setStage("speaking");
          },
          onBotStoppedSpeaking: () => {
            if (current()) setStage("listening");
          },
          onUserTranscript: (data) => {
            if (current() && data.final) append("user", data.text);
          },
          onBotTtsText: (data) => {
            if (current()) append("emma", data.text);
          },
        },
      });
      clientRef.current = client;
      await client.connect({
        webrtcRequestParams: { endpoint: `${backend}/api/offer` },
      });
      if (!current()) {
        client.enableMic(false);
        await client.disconnect();
      }
    } catch (cause) {
      if (!current()) return;
      stop();
      setError(
        cause instanceof TypeError
          ? "Start the Pipecat backend on port 7860, then try again."
          : cause instanceof Error
            ? cause.message
            : "Could not start voice session.",
      );
    }
  }

  async function endSession() {
    setEnding(true);
    stop();
    try {
      if (messages.length === 0) return;
      const auth = await fetch("/api/auth/session");
      const session = auth.ok
        ? ((await auth.json()) as { user?: { id?: string } | null } | null)
        : null;
      if (session?.user?.id) {
        const result = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
        if (!result.ok) throw new Error("Could not save to your account.");
        setSessionSummary("Saved to your account.");
      } else {
        const result = saveConversation(messages);
        if (!result.ok) throw new Error(result.error);
        setSessionSummary("Saved on this device. Sign in to save to your account.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setEnding(false);
    }
  }

  const status =
    stage === "connecting"
      ? "Connecting"
      : stage === "listening"
        ? "Listening"
        : stage === "speaking"
          ? "Speaking"
          : messages.length > 0
            ? "Paused"
            : "Ready when you are";

  const hint =
    stage === "connecting"
      ? "Opening a live line with Emma…"
      : stage === "listening"
        ? "Just talk. You can interrupt her anytime."
        : stage === "speaking"
          ? "I'm here with you."
          : messages.length > 0
            ? "Tap to pick up where you left off"
            : "Tap the button. Then just talk — I'll wait, and you can interrupt me.";

  return (
    <div
      className="talk-stage"
      data-stage={stage === "idle" || stage === "connecting" ? "idle" : stage}
      data-live={live ? "true" : "false"}
    >
      <div className="talk-ambient" aria-hidden>
        <span className="talk-blob talk-blob-a" />
        <span className="talk-blob talk-blob-b" />
        <span className="talk-blob talk-blob-c" />
      </div>

      <div className="talk-presence">
        <div className="talk-halo" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="talk-avatar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/emma-avatar.png" alt="" width={220} height={220} />
        </div>
        <div className="talk-waves" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      </div>

      <p className="talk-kicker">In session</p>
      <h1 className="talk-name">Emma</h1>
      <p className="talk-status" aria-live="polite">
        <span className="talk-status-dot" />
        {status}
      </p>
      <p className="talk-hint">{hint}</p>

      <div className="talk-quote">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.p
              key="error"
              className="talk-error"
              role="alert"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {error}
            </motion.p>
          ) : lastYou && stage === "listening" ? (
            <motion.p
              key={lastYou}
              className="talk-line talk-line-you"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span>You</span>
              {lastYou}
            </motion.p>
          ) : lastEmma ? (
            <motion.p
              key={lastEmma}
              className="talk-line talk-line-emma"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span>Emma</span>
              {lastEmma}
            </motion.p>
          ) : (
            <p className="talk-line talk-line-empty">
              A quiet space to say what's on your mind.
            </p>
          )}
        </AnimatePresence>
      </div>

      <motion.button
        type="button"
        className={`talk-cta${live ? " is-live" : ""}`}
        onClick={() => (live || stage === "connecting" ? stop() : void start())}
        whileTap={{ scale: 0.97 }}
        transition={springBouncy}
      >
        <span className="talk-cta-icon" aria-hidden>
          {live || stage === "connecting" ? <StopGlyph /> : <MicGlyph />}
        </span>
        {stage === "connecting"
          ? "Cancel"
          : live
            ? "Pause"
            : messages.length > 0
              ? "Continue"
              : "Start talking"}
      </motion.button>

      <div className="talk-foot">
        {messages.length > 0 ? (
          <button
            type="button"
            className="talk-end"
            onClick={() => void endSession()}
            disabled={ending}
          >
            {ending ? "Wrapping up…" : "End session"}
          </button>
        ) : (
          <p className="talk-privacy">Private · no judgment · not emergency care</p>
        )}
      </div>

      {sessionSummary ? <p className="talk-summary">{sessionSummary}</p> : null}

      <audio ref={audioRef} autoPlay className="sr-only" aria-label="Emma’s voice" />
    </div>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  );
}
