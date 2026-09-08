"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceOrb } from "@/components/voice-orb";
import type { PipecatClient } from "@pipecat-ai/client-js";
import type { ChatMessage } from "@/components/voice-session";
import { saveConversation } from "@/lib/session-history-storage";

const backend = "http://127.0.0.1:7860";

export function PipecatSession() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<PipecatClient | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const stop = useCallback(() => {
    release();
    setStatus("idle");
    setMuted(false);
    setSpeaking(false);
  }, [release]);

  const append = (role: ChatMessage["role"], text: string) => {
    if (!text.trim()) return;
    setMessages(previous => {
      const last = previous.at(-1);
      if (last?.role === role) {
        return [...previous.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
      }
      return [...previous, { id: crypto.randomUUID(), role, text }];
    });
  };

  async function start() {
    if (clientRef.current || abortRef.current && !abortRef.current.signal.aborted && status !== "idle") return;
    release();
    const run = generation.current;
    const current = () => generation.current === run;
    setError(null);
    setBanner(null);
    setStatus("connecting");
    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
      if (!current()) return;
      stop();
      setError("Connection timed out. Check the voice backend and provider keys, then try again.");
    }, 30000);
    try {
      const response = await fetch(`${backend}/health`, { signal: controller.signal });
      if (!response.ok) throw new Error("The voice backend is unavailable.");
      const health = await response.json() as { ready: boolean; missing: string[] };
      if (!health.ready) throw new Error(`Configure voice-backend/.env: ${health.missing.join(", ")}`);
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import("@pipecat-ai/client-js"), import("@pipecat-ai/small-webrtc-transport"),
      ]);
      if (!current()) return;
      setMessages([]);
      const client = new PipecatClient({
        transport: new SmallWebRTCTransport({ iceServers: [], waitForICEGathering: true }),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onBotReady: () => {
            if (!current()) return;
            if (timerRef.current) clearTimeout(timerRef.current);
            setStatus("live");
          },
          onDisconnected: () => {
            if (current()) {
              stop();
              setError("Session disconnected. You can save this conversation or start again.");
            }
          },
          onError: () => {
            if (current()) {
              stop();
              setError("Voice connection failed. Check provider keys, model access, and available quota.");
            }
          },
          onTrackStarted: (track, participant) => {
            if (!current() || participant?.local || track.kind !== "audio") return;
            const audio = audioRef.current;
            if (audio) {
              audio.srcObject = new MediaStream([track]);
              void audio.play().catch(() => {
                if (current()) setError("Press play on the audio control to hear Emma.");
              });
            }
          },
          onBotStartedSpeaking: () => { if (current()) setSpeaking(true); },
          onBotStoppedSpeaking: () => { if (current()) setSpeaking(false); },
          onUserTranscript: data => {
            if (current() && data.final) append("user", data.text);
          },
          // TTS text tracks spoken output instead of the entire generated LLM reply.
          onBotTtsText: data => { if (current()) append("emma", data.text); },
        },
      });
      clientRef.current = client;
      await client.connect({ webrtcRequestParams: { endpoint: `${backend}/api/offer` } });
      if (!current()) {
        client.enableMic(false);
        await client.disconnect();
      }
    } catch (cause) {
      if (!current()) return;
      stop();
      setError(cause instanceof TypeError
        ? "Start the local voice backend on port 7860, then try again."
        : cause instanceof Error ? cause.message : "Could not start voice session.");
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setBanner(null);
    try {
      const auth = await fetch("/api/auth/session");
      if (!auth.ok) throw new Error("Could not check sign-in status. Try saving again.");
      const session = await auth.json() as { user?: { id?: string } | null } | null;
      if (session?.user?.id) {
        const result = await fetch("/api/chats", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
        if (!result.ok) throw new Error("Could not save to your account. Try again.");
        setBanner("Saved to your account.");
      } else {
        const result = saveConversation(messages);
        if (!result.ok) throw new Error(result.error);
        setBanner("Saved on this device. Sign in to save to your account.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="voice-chat">
    <header className="voice-chat-header">
      <div className="voice-chat-header-top">
        <div>
          <h2 className="voice-chat-title">Emma</h2>
          <p className="voice-chat-sub" role="status">
            {status === "live" ? muted ? "Microphone muted" : "Live" : status === "connecting" ? "Connecting…" : "Ready"}
          </p>
        </div>
        <div className="voice-chat-header-actions">
          {messages.length > 0 && <button className="btn btn-outline" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>}
          {status === "live" && <button className="btn btn-outline" onClick={() => {
            clientRef.current?.enableMic(muted);
            setMuted(!muted);
          }}>{muted ? "Unmute microphone" : "Mute microphone"}</button>}
          {status === "idle"
            ? <button className="btn btn-primary" onClick={() => void start()}>Start session</button>
            : <button className="btn btn-outline" onClick={stop}>{status === "connecting" ? "Cancel" : "End session"}</button>}
        </div>
      </div>
    </header>
    <VoiceOrb
      state={status === "connecting" ? "connecting" : status === "live" ? muted ? "paused" : speaking ? "speaking" : "live" : "ready"}
      action={status === "live" ? muted ? "Tap to unmute your microphone" : "Tap to mute your microphone" : "Tap the microphone to begin"}
      onClick={() => { if (status === "live") { clientRef.current?.enableMic(muted); setMuted(!muted); } else void start(); }}
    />
    {banner && <p className="voice-chat-save-banner" role="status">{banner}</p>}
    <details className="voice-transcript">
    <summary>Conversation transcript</summary>
    <div className="voice-chat-messages" ref={logRef} role="log" aria-live="polite">
      {messages.length === 0 && <p>Start when you’re ready to talk. Emma offers supportive conversation and is not a licensed clinician or emergency service.</p>}
      {messages.map(message => <div className={`voice-chat-row voice-chat-row-${message.role}`} key={message.id}>
        <div className="voice-chat-bubble">
          <span className="voice-chat-bubble-label">{message.role === "user" ? "You" : "Emma"}</span>
          <p className="voice-chat-bubble-text">{message.text}</p>
        </div>
      </div>)}
    </div>
    </details>
    <footer className="voice-chat-composer">
      {error && <p className="voice-session-error" role="alert">{error}</p>}
      <audio ref={audioRef} autoPlay controls aria-label="Emma’s voice" />
      <p className="voice-chat-sub">Speak naturally. You can interrupt Emma while she talks.</p>
    </footer>
  </div>;
}
