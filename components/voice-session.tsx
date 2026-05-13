"use client";

import type {
  LiveConnectConfig,
  LiveServerMessage,
  Session,
} from "@google/genai/web";
import { GoogleGenAI, MediaResolution, Modality, StartSensitivity } from "@google/genai/web";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isGeminiLiveTokenResponse,
  type GeminiLiveTokenErrorBody,
} from "@/lib/gemini-voice-session";
import { getEmmaLiveSystemInstruction } from "@/lib/emma-live";
import {
  saveConversation,
} from "@/lib/session-history-storage";

type Status =
  | "idle"
  | "token"
  | "connecting"
  | "live"
  | "stopping"
  | "error";

type ChatRole = "user" | "emma";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

function appendToRole(
  prev: ChatMessage[],
  role: ChatRole,
  fragment: string,
): ChatMessage[] {
  if (!fragment) return prev;
  const last = prev.at(-1);
  if (last?.role === role) {
    return prev.map((m, i) =>
      i === prev.length - 1 ? { ...m, text: m.text + fragment } : m,
    );
  }
  return [
    ...prev,
    {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role,
      text: fragment,
    },
  ];
}

function resampleFloat32(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}

function floatToPcm16(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Base64 for Gemini Live `audio: { data, mimeType }` (not a DOM Blob). */
function bytesToBase64(buffer: ArrayBuffer): string {
  const u8 = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]!);
  }
  return btoa(binary);
}

function decodeBase64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(buf, 0, bin.length / 2);
}

const WELCOME_MESSAGES: ChatMessage[] = [
  {
    id: "welcome",
    role: "emma",
    text: "Hi — I'm Emma, your virtual therapist. When you're ready, start a session and we can talk by voice or text. I'm not a substitute for crisis services or a licensed clinician.",
  },
];

/** Used only if `/api/gemini/live-token` omits `connectConfig` (older deploy). Mirrors cookbook Live config. */
const FALLBACK_LIVE_CONNECT_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  systemInstruction: getEmmaLiveSystemInstruction(),
  speechConfig: {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
    languageCode: "en-US",
  },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  realtimeInputConfig: {
    automaticActivityDetection: {
      prefixPaddingMs: 120,
      silenceDurationMs: 550,
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
    },
  },
  contextWindowCompression: {
    triggerTokens: "104857",
    slidingWindow: {
      targetTokens: "52428",
    },
  },
};

export function VoiceSession() {
  const formId = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(WELCOME_MESSAGES);
  const [draft, setDraft] = useState("");
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micTapNodeRef = useRef<AudioNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayRef = useRef(0);
  const outCtxRef = useRef<AudioContext | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const micMutedRef = useRef(false);
  /** Mic graph is running (getUserMedia + worklet or legacy tap). Voice UI only when true. */
  const [micReady, setMicReady] = useState(false);
  /** Full break: no mic, no Emma audio playback, no sending text until resumed. */
  const conversationPausedRef = useRef(false);
  const [conversationPaused, setConversationPaused] = useState(false);

  /** True while user clicked End session / unmount cleanup — suppresses "disconnected" noise. */
  const voluntarySessionEndRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(id);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!saveBanner) return;
    const t = window.setTimeout(() => setSaveBanner(null), 6000);
    return () => window.clearTimeout(t);
  }, [saveBanner]);

  const canSaveConversation = useMemo(
    () => messages.some((m) => m.id !== "welcome" && m.text.trim().length > 0),
    [messages],
  );

  const handleSaveConversation = useCallback(async () => {
    setSaveBanner(null);
    const trimmed = messages
      .map((m) => ({ ...m, text: m.text.trim() }))
      .filter((m) => m.text.length > 0);

    const authRes = await fetch("/api/auth/session", {
      credentials: "same-origin",
    }).catch(() => null);
    const authJson = authRes?.ok
      ? ((await authRes.json()) as { user?: { id?: string } })
      : {};
    const userId = authJson.user?.id;

    if (userId) {
      try {
        const res = await fetch("/api/chats", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: trimmed }),
        });
        const raw: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = raw as { error?: string };
          setError(err.error ?? `Save failed (${res.status})`);
          return;
        }
        setError(null);
        setSaveBanner("Saved.");
        return;
      } catch {
        setError("Could not reach the server.");
        return;
      }
    }

    const result = saveConversation(messages);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSaveBanner("Saved on this device. Sign in to save to your account.");
  }, [messages]);

  const stopMic = useCallback(() => {
    micTapNodeRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    muteRef.current?.disconnect();
    micTapNodeRef.current = null;
    micSourceRef.current = null;
    muteRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void micCtxRef.current?.close();
    micCtxRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    voluntarySessionEndRef.current = true;
    conversationPausedRef.current = false;
    setConversationPaused(false);
    stopMic();
    micMutedRef.current = false;
    setMicReady(false);
    try {
      sessionRef.current?.close();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    nextPlayRef.current = 0;
    void outCtxRef.current?.close();
    outCtxRef.current = null;
    setStatus("idle");
  }, [stopMic]);

  useEffect(() => {
    return () => {
      voluntarySessionEndRef.current = true;
      conversationPausedRef.current = false;
      stopMic();
      try {
        sessionRef.current?.close();
      } catch {
        /* ignore */
      }
      sessionRef.current = null;
      void outCtxRef.current?.close();
      outCtxRef.current = null;
    };
  }, [stopMic]);

  const playPcmBase64 = useCallback((b64: string) => {
    if (conversationPausedRef.current) return;
    const int16 = decodeBase64ToInt16(b64);
    if (!outCtxRef.current) {
      outCtxRef.current = new AudioContext();
      nextPlayRef.current = outCtxRef.current.currentTime;
      void outCtxRef.current.resume();
    }
    const ctx = outCtxRef.current;
    const buffer = ctx.createBuffer(1, int16.length, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) {
      ch[i] = int16[i]! / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, nextPlayRef.current);
    src.start(start);
    nextPlayRef.current = start + buffer.duration;
  }, []);

  const handleServerMessage = useCallback(
    (msg: LiveServerMessage) => {
      const sc = msg.serverContent;
      const paused = conversationPausedRef.current;
      if (sc?.interrupted) {
        nextPlayRef.current = outCtxRef.current?.currentTime ?? 0;
      }
      if (!paused && sc?.inputTranscription?.text) {
        setMessages((m) => appendToRole(m, "user", sc.inputTranscription!.text!));
      }
      if (!paused && sc?.outputTranscription?.text) {
        setMessages((m) =>
          appendToRole(m, "emma", sc.outputTranscription!.text!),
        );
      }
      const parts = sc?.modelTurn?.parts;
      if (parts && !paused) {
        for (const part of parts) {
          const mime = part.inlineData?.mimeType ?? "";
          const data = part.inlineData?.data;
          if (data && mime.includes("audio")) {
            playPcmBase64(data);
          }
          if (part.text) {
            setMessages((m) => appendToRole(m, "emma", part.text!));
          }
        }
      }
    },
    [playPcmBase64],
  );

  const startMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    streamRef.current = stream;
    const micCtx = new AudioContext();
    micCtxRef.current = micCtx;
    await micCtx.resume();
    const source = micCtx.createMediaStreamSource(stream);
    micSourceRef.current = source;

    const inputRate = micCtx.sampleRate;
    const minInputSamples = 4096;
    let acc = new Float32Array(0);

    const flushInputBlock = (block: Float32Array) => {
      const sess = sessionRef.current;
      if (!sess || micMutedRef.current || conversationPausedRef.current) return;
      const resampled = resampleFloat32(block, inputRate, 16000);
      const pcm = floatToPcm16(resampled);
      const audio = {
        mimeType: "audio/pcm;rate=16000",
        data: bytesToBase64(pcm),
      };
      try {
        sess.sendRealtimeInput({ audio });
      } catch {
        /* socket may be closing */
      }
    };

    const pushSamples = (chunk: Float32Array) => {
      const next = new Float32Array(acc.length + chunk.length);
      next.set(acc, 0);
      next.set(chunk, acc.length);
      acc = next;
      while (acc.length >= minInputSamples) {
        const block = acc.subarray(0, minInputSamples);
        acc = acc.slice(minInputSamples);
        flushInputBlock(block);
      }
    };

    const mute = micCtx.createGain();
    mute.gain.value = 0;
    muteRef.current = mute;

    let usedWorklet = false;
    try {
      const workletUrl = new URL(
        "/audio/pcm-capture-processor.js",
        window.location.origin,
      ).href;
      await micCtx.audioWorklet.addModule(workletUrl);
      const workletNode = new AudioWorkletNode(micCtx, "pcm-capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      micTapNodeRef.current = workletNode;
      workletNode.port.onmessage = (ev: MessageEvent) => {
        const d = ev.data;
        if (d instanceof Float32Array && d.length > 0) {
          pushSamples(d);
        }
      };
      source.connect(workletNode);
      workletNode.connect(mute);
      usedWorklet = true;
    } catch {
      usedWorklet = false;
    }

    if (!usedWorklet) {
      const bufferSize = 4096;
      const processor = micCtx.createScriptProcessor(bufferSize, 1, 1);
      micTapNodeRef.current = processor;
      processor.onaudioprocess = (ev) => {
        ev.outputBuffer.getChannelData(0).fill(0);
        const sess = sessionRef.current;
        if (!sess || micMutedRef.current || conversationPausedRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const resampled = resampleFloat32(input, micCtx.sampleRate, 16000);
        const pcm = floatToPcm16(resampled);
        const audio = {
          mimeType: "audio/pcm;rate=16000",
          data: bytesToBase64(pcm),
        };
        try {
          sess.sendRealtimeInput({ audio });
        } catch {
          /* socket may be closing */
        }
      };
      source.connect(processor);
      processor.connect(mute);
    } else {
      mute.connect(micCtx.destination);
    }

    if (!usedWorklet) {
      mute.connect(micCtx.destination);
    }
  }, []);

  const sendTypedMessage = useCallback(() => {
    const text = draft.trim();
    const sess = sessionRef.current;
    if (!text) return;
    if (conversationPausedRef.current) {
      setError(
        "Paused — resume the conversation to send.",
      );
      return;
    }
    if (!sess || status !== "live") {
      setError("Wait for Live, then send.");
      return;
    }
    setDraft("");
    setMessages((m) => appendToRole(m, "user", text));
    try {
      sess.sendClientContent({
        turns: { role: "user", parts: [{ text }] },
        turnComplete: true,
      });
    } catch {
      try {
        sess.sendRealtimeInput({ text });
      } catch {
        setError("Could not send. Reconnect.");
      }
    }
  }, [draft, status]);

  const pauseConversation = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess || conversationPausedRef.current) return;
    conversationPausedRef.current = true;
    setConversationPaused(true);
    setError(null);
    nextPlayRef.current = outCtxRef.current?.currentTime ?? nextPlayRef.current;
    void outCtxRef.current?.suspend().catch(() => {
      /* ignore */
    });
    if (micReady && !micMutedRef.current) {
      micMutedRef.current = true;
      try {
        sess.sendRealtimeInput({ audioStreamEnd: true });
      } catch {
        setError("Could not pause — try again.");
        conversationPausedRef.current = false;
        setConversationPaused(false);
        void outCtxRef.current?.resume().catch(() => {});
        micMutedRef.current = false;
      }
    }
  }, [micReady]);

  const resumeConversation = useCallback(() => {
    if (!conversationPausedRef.current) return;
    conversationPausedRef.current = false;
    setConversationPaused(false);
    setError(null);
    void outCtxRef.current?.resume().catch(() => {
      /* ignore */
    });
    if (micReady) {
      micMutedRef.current = false;
    }
  }, [micReady]);

  const start = useCallback(async () => {
    voluntarySessionEndRef.current = false;
    conversationPausedRef.current = false;
    setConversationPaused(false);
    setError(null);
    setMessages([...WELCOME_MESSAGES]);
    setStatus("token");
    try {
      const res = await fetch("/api/gemini/live-token", {
        method: "POST",
        credentials: "include",
      });
      const raw: unknown = await res.json();
      if (!res.ok) {
        const err = raw as GeminiLiveTokenErrorBody;
        if (res.status === 401) {
        setError("Sign in to start a voice session.");
        } else {
          setError(err.error ?? `HTTP ${res.status}`);
        }
        setStatus("error");
        setMessages(WELCOME_MESSAGES);
        return;
      }
      if (!isGeminiLiveTokenResponse(raw)) {
        setError("Could not start. Try again.");
        setStatus("error");
        setMessages(WELCOME_MESSAGES);
        return;
      }
      const body = raw;
      setStatus("connecting");
      const liveCfg = (body.connectConfig ??
        FALLBACK_LIVE_CONNECT_CONFIG) as LiveConnectConfig;
      const ai = new GoogleGenAI({
        apiKey: body.apiKey,
        httpOptions: body.httpOptions ?? { apiVersion: "v1alpha" },
      });

      const liveSession = await ai.live.connect({
        model: body.model,
        config: liveCfg,
        callbacks: {
          onmessage: (m: LiveServerMessage) => {
            handleServerMessage(m);
          },
          onerror: (ev: ErrorEvent) => {
            setError(ev.message || "Connection issue. Try again or restart the session.");
          },
          onclose: (ev: CloseEvent) => {
            const voluntary = voluntarySessionEndRef.current;
            voluntarySessionEndRef.current = false;
            conversationPausedRef.current = false;
            setConversationPaused(false);
            stopMic();
            micMutedRef.current = false;
            setMicReady(false);
            sessionRef.current = null;
            setStatus("idle");
            if (!voluntary) {
              const code = ev?.code;
              setError(
                typeof code === "number"
                  ? `Disconnected (${code}). Start again.`
                  : "Disconnected. Start again.",
              );
            }
          },
        },
      });

      sessionRef.current = liveSession;
      try {
        await startMic();
        setMicReady(true);
      } catch (e: unknown) {
        stopMic();
        setMicReady(false);
        setError(
          e instanceof Error
            ? `Mic blocked (${e.message}). Text still works.`
            : "Mic unavailable. Text still works.",
        );
      }
      {
        try {
          let out = outCtxRef.current;
          if (!out) {
            out = new AudioContext();
            outCtxRef.current = out;
            nextPlayRef.current = out.currentTime;
          }
          await out.resume();
        } catch {
          /* playback may resume on first audio chunk */
        }
      }
      setStatus("live");
      micMutedRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
      setStatus("error");
      setMessages(WELCOME_MESSAGES);
    }
  }, [handleServerMessage, startMic, stopMic]);

  const stop = useCallback(() => {
    setStatus("stopping");
    stopAll();
  }, [stopAll]);

  const busy = status === "token" || status === "connecting" || status === "stopping";
  const isLive = status === "live";

  return (
    <div className="voice-chat">
      <header className="voice-chat-header">
        <div className="voice-chat-header-top">
          <div className="voice-chat-header-main">
            <div className="voice-chat-avatar" aria-hidden>
              <span className="logo-mark sm" />
            </div>
            <div>
              <h2 className="voice-chat-title">Emma</h2>
              <p className="voice-chat-sub">
                {isLive ? (
                  conversationPaused ? (
                    <span className="voice-chat-status voice-chat-status-idle">
                      Paused
                    </span>
                  ) : (
                    <span className="voice-chat-status voice-chat-status-live">
                      Live
                    </span>
                  )
                ) : busy ? (
                  <span className="voice-chat-status">Connecting…</span>
                ) : (
                  <span className="voice-chat-status voice-chat-status-idle">
                    Ready
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="voice-chat-header-actions">
            {canSaveConversation && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void handleSaveConversation()}
              >
                Save
              </button>
            )}
            {isLive ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={
                    conversationPaused ? resumeConversation : pauseConversation
                  }
                >
                  {conversationPaused ? "Resume" : "Pause"}
                </button>
                <button type="button" className="btn btn-outline" onClick={stop}>
                  End session
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void start()}
                disabled={busy}
              >
                {status === "idle" || status === "error"
                  ? "Start session"
                  : "Connecting…"}
              </button>
            )}
            <Link href="/" className="btn btn-ghost">
              Home
            </Link>
          </div>
        </div>
      </header>

      {saveBanner && (
        <p className="voice-chat-save-banner" role="status">
          {saveBanner}
        </p>
      )}

      <div className="voice-chat-messages" ref={scrollRef} role="log" aria-live="polite">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`voice-chat-row voice-chat-row-${msg.role}`}
          >
            <div className="voice-chat-bubble">
              <span className="voice-chat-bubble-label">
                {msg.role === "user" ? "You" : "Emma"}
              </span>
              <p className="voice-chat-bubble-text">{msg.text}</p>
            </div>
          </div>
        ))}
      </div>

      {isLive && !micReady && (
        <div
          className="voice-chat-mic-strip voice-chat-mic-strip-warn"
          role="status"
        >
          <p className="voice-chat-mic-strip-warn-text">
            Allow the microphone in your browser to use voice. You can still type.
          </p>
        </div>
      )}

      <footer className="voice-chat-composer">
        {error && <p className="voice-session-error">{error}</p>}
        {error?.includes("log in") && (
          <p className="voice-chat-login-row">
            <Link href="/login?callbackUrl=/session" className="btn btn-primary">
              Log in with Google
            </Link>
          </p>
        )}

        <form
          id={formId}
          className="voice-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendTypedMessage();
          }}
        >
          <textarea
            className="voice-chat-input"
            rows={2}
            placeholder={
              isLive
                ? conversationPaused
                  ? "Resume to type…"
                  : "Message…"
                : "Message… start session, then Send"
            }
            value={draft}
            disabled={isLive && conversationPaused}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendTypedMessage();
              }
            }}
          />
          <div className="voice-chat-form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!isLive || !draft.trim() || conversationPaused}
            >
              Send
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}
