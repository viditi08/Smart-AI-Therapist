"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { CrisisModal } from "@/components/crisis-modal";
import { detectCrisis } from "@/lib/crisis-detection";
import { springBouncy } from "@/lib/motion-presets";
import type { CrisisLevel } from "@/lib/pipeline-types";
import {
  persistConversation,
  type SavedChatMessage,
} from "@/lib/session-history-storage";

type Stage = "idle" | "connecting" | "listening" | "speaking";

const INTRO = "Hi, I'm Emma. I'm here with you. What's on your mind?";

export function PipecatSession() {
  const [stage, setStage] = useState<Stage>("idle");
  const [messages, setMessages] = useState<SavedChatMessage[]>([]);
  const [liveYou, setLiveYou] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<Exclude<CrisisLevel, "none"> | null>(null);
  const clientRef = useRef<PipecatClient | null>(null);
  const messagesRef = useRef<SavedChatMessage[]>([]);
  const startingRef = useRef(false);
  const userStoppedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = stage === "listening" || stage === "speaking";

  messagesRef.current = messages;
  const recent = messages.slice(-4);

  const release = useCallback(() => {
    startingRef.current = false;
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

  const stop = useCallback((fromUser = true) => {
    userStoppedRef.current = fromUser;
    setLiveYou("");
    release();
    setStage("idle");
  }, [release]);

  const append = (role: SavedChatMessage["role"], text: string) => {
    if (!text.trim()) return;
    setMessages((previous) => {
      const last = previous.at(-1);
      if (last?.role === role) {
        const nextText =
          role === "emma" ? `${last.text}${text}` : `${last.text} ${text}`;
        return [...previous.slice(0, -1), { ...last, text: nextText }];
      }
      return [...previous, { id: crypto.randomUUID(), role, text }];
    });
  };

  async function start() {
    if (clientRef.current || startingRef.current) return;
    release();
    startingRef.current = true;
    const run = generation.current;
    const current = () => generation.current === run;
    userStoppedRef.current = false;
    setError(null);
    setSessionSummary(null);
    setCrisis(null);
    setLiveYou("");
    setStage("connecting");
    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
      if (!current()) return;
      stop();
      setError(
        "Connection timed out. Check the LiveKit and backend configuration, then try again.",
      );
    }, 45000);
    try {
      // Load the transport while Render wakes and creates the room.
      const clientModules = Promise.all([
        import("@pipecat-ai/client-js"),
        import("@pipecat-ai/livekit-transport"),
      ]);
      const sessionResponse = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      if (!sessionResponse.ok) {
        const detail = (await sessionResponse.json().catch(() => null)) as
          | { detail?: string }
          | null;
        throw new Error(detail?.detail ?? "Could not create a LiveKit session.");
      }
      const connection = (await sessionResponse.json()) as {
        url: string;
        token: string;
      };
      const [{ PipecatClient }, { LiveKitTransport }] = await clientModules;
      if (!current()) return;
      const client = new PipecatClient({
        transport: new LiveKitTransport({
          webAudioMix: false,
          audioCaptureDefaults: {
            autoGainControl: true,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: false,
          },
        }),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onBotReady: () => {
            if (!current()) return;
            startingRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
            setStage("listening");
            setMessages((previous) =>
              previous.some((message) => message.role === "emma")
                ? previous
                : [{ id: crypto.randomUUID(), role: "emma", text: INTRO }],
            );
          },
          onDeviceError: () => {
            if (current()) {
              setError(
                "Microphone is blocked. Allow access in the browser, then try again.",
              );
            }
          },
          onDisconnected: () => {
            if (!current()) return;
            const fromUser = userStoppedRef.current;
            stop(false);
            if (!fromUser) {
              setError("Emma lost the connection. Tap Continue and speak again.");
            }
          },
          onError: () => {
            if (current()) {
              stop();
              setError(
                "Emma could not start listening. Check the microphone, then try again.",
              );
            }
          },
          onTrackStarted: (track, participant) => {
            if (!current() || participant?.local || track.kind !== "audio") return;
            const audio = audioRef.current;
            if (!audio) return;
            const currentStream = audio.srcObject;
            const alreadyAttached =
              currentStream instanceof MediaStream &&
              currentStream.getAudioTracks().some((existing) => existing.id === track.id);
            if (!alreadyAttached) {
              audio.srcObject = new MediaStream([track]);
            }
            audio.muted = false;
            audio.volume = 1;
            void audio.play().catch(() => {
              if (current()) {
                setError("Click the page once so your browser can play Emma’s voice.");
              }
            });
          },
          onBotStartedSpeaking: () => {
            if (!current()) return;
            setStage("speaking");
            void audioRef.current?.play().catch(() => {});
          },
          onBotStoppedSpeaking: () => {
            if (current()) setStage("listening");
          },
          onUserStartedSpeaking: () => {
            if (current()) setStage("listening");
          },
          onUserTranscript: (data) => {
            if (!current() || !data.text.trim()) return;
            setLiveYou(data.text);
            if (!data.final) return;
            append("user", data.text);
            setLiveYou("");
            const detected = detectCrisis(data.text);
            if (detected.level === "none") return;
            setCrisis(detected.level);
            if (detected.level === "imminent") stop();
          },
          onBotLlmText: (data) => {
            if (current()) append("emma", data.text);
          },
        },
      });
      clientRef.current = client;
      await client.connect(connection);
      if (!current()) {
        await client.enableMic(false);
        await client.disconnect();
      }
    } catch (cause) {
      if (!current()) return;
      stop();
      setError(
        cause instanceof Error ? cause.message : "Could not start voice session.",
      );
    }
  }

  async function endSession() {
    setEnding(true);
    const snapshot = messagesRef.current;
    stop();
    try {
      if (snapshot.length === 0) return;
      const result = await persistConversation(snapshot);
      if (!result.ok) throw new Error(result.error);
      setSessionSummary(result.summary);
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
          ) : recent.length > 0 || liveYou ? (
            <motion.div
              key="transcript"
              className="talk-transcript"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {recent.map((message) => (
                <p
                  key={message.id}
                  className={`talk-line ${message.role === "user" ? "talk-line-you" : "talk-line-emma"}`}
                >
                  <span>{message.role === "user" ? "You" : "Emma"}</span>
                  {message.text}
                </p>
              ))}
              {liveYou ? (
                <p className="talk-line talk-line-you talk-line-live">
                  <span>You</span>
                  {liveYou}
                </p>
              ) : null}
            </motion.div>
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
        onClick={() =>
          live || stage === "connecting" ? stop(true) : void start()
        }
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

      {crisis ? (
        <CrisisModal level={crisis} onDismiss={() => setCrisis(null)} />
      ) : null}

      <audio
        ref={audioRef}
        autoPlay
        playsInline
        className="sr-only"
        aria-label="Emma’s voice"
      />
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
