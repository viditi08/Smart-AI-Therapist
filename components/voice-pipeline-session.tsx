"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { CrisisModal } from "@/components/crisis-modal";
import {
  getSpeechRecognition,
  isSpeechRecognitionSupported,
  speakText,
  stopSpeaking,
  type SpeechRecognitionLike,
} from "@/lib/browser-speech";
import {
  blobToBase64,
  isMediaRecorderSupported,
  pickRecorderMimeType,
} from "@/lib/mic-recorder";
import { loadOnboarding, type OnboardingAnswers } from "@/lib/onboarding";
import {
  audioBase64ToBlob,
  createPipelineSession,
  friendlyFetchError,
  runPipelineTurn,
  summarizePipelineSession,
  synthesizePipelineSpeech,
  transcribePipelineAudio,
} from "@/lib/pipeline-client";
import type { CrisisLevel } from "@/lib/pipeline-types";
import { springBouncy } from "@/lib/motion-presets";

type Turn = { role: "user" | "assistant"; content: string };

type Stage = "idle" | "listening" | "stt" | "thinking" | "speaking";

/** Mic loudness (RMS) counted as speech rather than room noise. */
const SPEECH_RMS = 0.035;
/** Pause after you finish a thought. */
const END_OF_SPEECH_MS = 700;
const MAX_UTTERANCE_MS = 30_000;
const NO_SPEECH_MS = 12_000;
/** Anything shorter than this is background noise, not a sentence. */
const MIN_UTTERANCE_BYTES = 1200;

export function VoicePipelineSession() {
  const sessionIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speakFallbackRef = useRef(false);
  const playbackCancelledRef = useRef(false);
  const transcriptRef = useRef<Turn[]>([]);
  const liveRef = useRef(false);
  /** "listen" watches for the end of your sentence, "guard" watches for you interrupting Emma. */
  const vadModeRef = useRef<"off" | "listen" | "guard">("off");
  const emptyTurnsRef = useRef(0);
  const interimRef = useRef("");
  const ttsRemainingRef = useRef(0);
  const streamDoneRef = useRef(false);
  const beginTurnRef = useRef<((opts?: { keepVoice?: boolean }) => void) | null>(
    null,
  );
  const endTurnRef = useRef<(() => void) | null>(null);

  const [onboarding, setOnboarding] = useState<OnboardingAnswers | null>(null);
  const [live, setLive] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [interim, setInterim] = useState("");
  const [emmaLine, setEmmaLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCrisis, setLastCrisis] = useState<{
    level: CrisisLevel;
    matched: string[];
  } | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const recOk = isMediaRecorderSupported();
  const speechOk = isSpeechRecognitionSupported();

  useEffect(() => {
    setOnboarding(loadOnboarding());
  }, []);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const id = await createPipelineSession();
    sessionIdRef.current = id;
    return id;
  }, []);

  const stopPlayback = useCallback(() => {
    playbackCancelledRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    stopSpeaking();
  }, []);

  const teardownAudio = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    vadModeRef.current = "off";
    analyserRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      liveRef.current = false;
      teardownAudio();
      stopPlayback();
    };
  }, [stopPlayback, teardownAudio]);

  /** One analyser runs for the whole conversation; its meaning changes with the mode. */
  const runVadLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const samples = new Uint8Array(analyser.fftSize);
    let startedAt = performance.now();
    let lastLoudAt = startedAt;
    let heardSpeech = false;
    let mode: "off" | "listen" | "guard" = vadModeRef.current;

    const tick = () => {
      if (!liveRef.current || !analyserRef.current) return;

      if (vadModeRef.current !== mode) {
        mode = vadModeRef.current;
        startedAt = performance.now();
        lastLoudAt = startedAt;
        heardSpeech = false;
      }

      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();

      if (mode === "listen") {
        if (rms > SPEECH_RMS) {
          lastLoudAt = now;
          heardSpeech = true;
        }

        const finished = heardSpeech && now - lastLoudAt > END_OF_SPEECH_MS;
        const tooLong = now - startedAt > MAX_UTTERANCE_MS;
        const silent = !heardSpeech && now - startedAt > NO_SPEECH_MS;

        if (finished || tooLong || silent) {
          vadModeRef.current = "off";
          mode = "off";
          endTurnRef.current?.();
        }
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const maybeResumeListening = useCallback(() => {
    if (!liveRef.current || playbackCancelledRef.current) return;
    if (vadModeRef.current === "listen") return;
    if (!streamDoneRef.current || ttsRemainingRef.current > 0) return;
    beginTurnRef.current?.({ keepVoice: true });
  }, []);

  const enqueueTts = useCallback(
    (sentence: string) => {
      ttsRemainingRef.current += 1;
      ttsQueueRef.current = ttsQueueRef.current.then(async () => {
        if (playbackCancelledRef.current || !sentence.trim()) {
          ttsRemainingRef.current = Math.max(0, ttsRemainingRef.current - 1);
          maybeResumeListening();
          return;
        }

        const finish = () => {
          ttsRemainingRef.current = Math.max(0, ttsRemainingRef.current - 1);
          maybeResumeListening();
        };

        if (!speakFallbackRef.current) {
          const spoken = await synthesizePipelineSpeech(sentence);
          if (spoken && !playbackCancelledRef.current) {
            setEmmaLine(sentence);
            const blob = audioBase64ToBlob(spoken.audio, spoken.mimeType);
            const ctx = ctxRef.current;
            try {
              if (ctx) {
                await ctx.resume();
                const copy = await blob.arrayBuffer();
                const decoded = await ctx.decodeAudioData(copy);
                if (playbackCancelledRef.current) {
                  finish();
                  return;
                }
                await new Promise<void>((resolve) => {
                  const src = ctx.createBufferSource();
                  src.buffer = decoded;
                  src.connect(ctx.destination);
                  src.onended = () => resolve();
                  src.start();
                  audioRef.current = {
                    pause() {
                      try {
                        src.stop();
                      } catch {
                        /* already stopped */
                      }
                    },
                    src: "",
                  } as HTMLAudioElement;
                });
                finish();
                return;
              }
            } catch {
              /* fall through to element playback */
            }

            const url = URL.createObjectURL(blob);
            await new Promise<void>((resolve) => {
              const audio = new Audio(url);
              audioRef.current = audio;
              audio.onended = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              audio.onerror = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              void audio.play().then(undefined, () => {
                URL.revokeObjectURL(url);
                resolve();
              });
            });
            finish();
            return;
          }
          speakFallbackRef.current = true;
        }

        if (playbackCancelledRef.current) {
          finish();
          return;
        }
        await new Promise<void>((resolve) => {
          speakText(sentence, () => {
            finish();
            resolve();
          });
        });
      });
      return ttsQueueRef.current;
    },
    [maybeResumeListening],
  );

  /** Open the mic for one utterance; the analyser closes it when you pause. */
  const beginTurn = useCallback(
    (opts?: { keepVoice?: boolean }) => {
      const stream = streamRef.current;
      if (!liveRef.current || !stream) return;
      if (recorderRef.current && recorderRef.current.state === "recording") return;

      if (!opts?.keepVoice) stopPlayback();
      playbackCancelledRef.current = false;
      speakFallbackRef.current = false;
      interimRef.current = "";
      setInterim("");
      chunksRef.current = [];

      try {
        const mime = pickRecorderMimeType();
        const recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        recorder.start(200);
      } catch {
        setError("Could not start recording from the microphone.");
        return;
      }

      if (speechOk) {
        const recognition = getSpeechRecognition();
        if (recognition) {
          recognitionRef.current = recognition;
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = "en-US";
          recognition.onresult = (ev) => {
            let interimText = "";
            let finalText = "";
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const result = ev.results[i]!;
              const transcript = result[0]?.transcript ?? "";
              if (result.isFinal) finalText += transcript;
              else interimText += transcript;
            }
            const shown = interimText || finalText;
            interimRef.current = shown;
            setInterim(shown);
          };
          recognition.onerror = () => {};
          try {
            recognition.start();
          } catch {
            /* already running */
          }
        }
      }

      vadModeRef.current = "listen";
      setStage("listening");
    },
    [speechOk, stopPlayback],
  );

  const speakReply = useCallback(
    async (userText: string) => {
      setStage("thinking");
      setError(null);
      setLastCrisis(null);
      interimRef.current = "";
      setInterim("");
      playbackCancelledRef.current = false;
      speakFallbackRef.current = false;
      streamDoneRef.current = false;
      ttsRemainingRef.current = 0;
      ttsQueueRef.current = Promise.resolve();

      let sid: string;
      try {
        sid = await ensureSession();
      } catch (e) {
        setError(friendlyFetchError(e));
        if (liveRef.current) beginTurnRef.current?.();
        return;
      }

      transcriptRef.current.push({ role: "user", content: userText });
      let reply = "";

      try {
        await runPipelineTurn(
          {
            sessionId: sid,
            message: userText,
            mode: "voice",
            onboarding,
          },
          {
            onToken: (text) => {
              reply += text;
            },
            onSentence: (sentence) => {
              vadModeRef.current = "off";
              setStage("speaking");
              setEmmaLine(sentence);
              void enqueueTts(sentence);
            },
            onCrisis: (data) =>
              setLastCrisis({
                level: data.level as CrisisLevel,
                matched: data.matched,
              }),
            onSession: (data) => setTurnCount(data.turnNumber),
          },
        );

        transcriptRef.current.push({ role: "assistant", content: reply });
        streamDoneRef.current = true;
        maybeResumeListening();
      } catch (e) {
        transcriptRef.current.pop();
        if (e instanceof Error && e.message.includes("Session not found")) {
          sessionIdRef.current = null;
        }
        setError(friendlyFetchError(e));
        if (liveRef.current) beginTurnRef.current?.();
      }
    },
    [ensureSession, enqueueTts, maybeResumeListening, onboarding],
  );

  /** Close the mic and send whatever was captured. */
  const endTurn = useCallback(() => {
    vadModeRef.current = "off";
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    const liveInterim = interimRef.current.trim();
    const recorder = recorderRef.current;

    const discardRecorder = () => {
      if (!recorder || recorder.state === "inactive") return;
      recorder.ondataavailable = null;
      recorder.onstop = () => {};
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    };

    if (liveInterim) {
      recorderRef.current = null;
      discardRecorder();
      interimRef.current = "";
      setInterim("");
      emptyTurnsRef.current = 0;
      void speakReply(liveInterim);
      return;
    }

    if (!recorder || recorder.state === "inactive") {
      if (liveRef.current) beginTurnRef.current?.();
      return;
    }

    recorderRef.current = null;
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      void (async () => {
        if (blob.size < MIN_UTTERANCE_BYTES) {
          emptyTurnsRef.current += 1;
          if (emptyTurnsRef.current >= 6) {
            setError("I can't hear anything from the mic. Check the input device.");
            liveRef.current = false;
            setLive(false);
            teardownAudio();
            setStage("idle");
            return;
          }
          if (liveRef.current) beginTurnRef.current?.();
          return;
        }

        emptyTurnsRef.current = 0;
        setStage("stt");
        try {
          const { transcript } = await transcribePipelineAudio({
            mimeType: blob.type || "audio/webm",
            audio: await blobToBase64(blob),
          });
          const text = transcript.trim();
          if (!text) {
            if (liveRef.current) beginTurnRef.current?.();
            return;
          }
          await speakReply(text);
        } catch (e) {
          setError(friendlyFetchError(e));
          if (liveRef.current) beginTurnRef.current?.();
        }
      })();
    };
    recorder.stop();
  }, [speakReply, teardownAudio]);

  useEffect(() => {
    beginTurnRef.current = beginTurn;
    endTurnRef.current = endTurn;
  }, [beginTurn, endTurn]);

  const startConversation = useCallback(async () => {
    setError(null);
    emptyTurnsRef.current = 0;

    if (!recOk || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Try Chrome on localhost or https.");
      return;
    }

    try {
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      void ensureSession().catch(() => {});
      const stream = await streamPromise;
      streamRef.current = stream;

      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        setError("This browser cannot analyse microphone audio. Try Chrome.");
        return;
      }
      const ctx = new Ctor();
      await ctx.resume().catch(() => {});
      const unlock = ctx.createOscillator();
      const quiet = ctx.createGain();
      quiet.gain.value = 0.0001;
      unlock.connect(quiet);
      quiet.connect(ctx.destination);
      unlock.start();
      unlock.stop(ctx.currentTime + 0.05);
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      liveRef.current = true;
      setLive(true);
      runVadLoop();
      beginTurn();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Mic access is blocked. Allow it from the icon in the address bar, then try again."
          : name === "NotFoundError"
            ? "No microphone found. Connect one and try again."
            : name === "NotReadableError"
              ? "Another app is using the mic. Close it and try again."
              : `Could not start the microphone${name ? ` (${name})` : ""}.`,
      );
    }
  }, [beginTurn, ensureSession, recOk, runVadLoop]);

  const stopConversation = useCallback(() => {
    liveRef.current = false;
    setLive(false);
    teardownAudio();
    stopPlayback();
    setInterim("");
    setStage("idle");
  }, [stopPlayback, teardownAudio]);

  const endSession = useCallback(async () => {
    stopConversation();
    const transcript = transcriptRef.current.filter((t) => t.content.trim());
    if (transcript.length === 0) return;
    setEnding(true);
    try {
      setSessionSummary(await summarizePipelineSession(transcript));
    } catch (e) {
      setError(friendlyFetchError(e));
    } finally {
      setEnding(false);
    }
  }, [stopConversation]);

  const status = !live
    ? turnCount > 0
      ? "Paused"
      : "Ready when you are"
    : stage === "listening"
      ? "Listening"
      : stage === "stt"
        ? "Hearing you"
        : stage === "thinking"
          ? "Thinking"
          : stage === "speaking"
            ? "Speaking"
            : "With you";

  const hint = !live
    ? turnCount > 0
      ? "Tap to pick up where you left off"
      : "Tap the button. Then just talk — I'll wait for a pause."
    : stage === "listening"
      ? "Go ahead. Pause when you're done."
      : stage === "speaking"
        ? "I'm here with you."
        : "Give me a moment…";

  return (
    <div
      className="talk-stage"
      data-stage={live ? stage : "idle"}
      data-live={live ? "true" : "false"}
    >
      {lastCrisis && lastCrisis.level !== "none" ? (
        <CrisisModal
          level={lastCrisis.level === "elevated" ? "elevated" : "imminent"}
          onDismiss={() => setLastCrisis(null)}
        />
      ) : null}

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
          ) : interim ? (
            <motion.p
              key="you"
              className="talk-line talk-line-you"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span>You</span>
              {interim}
            </motion.p>
          ) : emmaLine ? (
            <motion.p
              key={emmaLine}
              className="talk-line talk-line-emma"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span>Emma</span>
              {emmaLine}
            </motion.p>
          ) : (
            <p className="talk-line talk-line-empty">
              A quiet space to say what&rsquo;s on your mind.
            </p>
          )}
        </AnimatePresence>
      </div>

      <motion.button
        type="button"
        className={`talk-cta${live ? " is-live" : ""}`}
        onClick={() => (live ? stopConversation() : void startConversation())}
        whileTap={{ scale: 0.97 }}
        transition={springBouncy}
      >
        <span className="talk-cta-icon" aria-hidden>
          {live ? <StopGlyph /> : <MicGlyph />}
        </span>
        {live ? "Pause" : turnCount > 0 ? "Continue" : "Start talking"}
      </motion.button>

      <div className="talk-foot">
        {turnCount > 0 ? (
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

      {sessionSummary ? (
        <p className="talk-summary">{sessionSummary}</p>
      ) : null}
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
