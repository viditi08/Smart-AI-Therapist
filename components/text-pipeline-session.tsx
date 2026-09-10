"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CrisisModal } from "@/components/crisis-modal";
import { TypingIndicator } from "@/components/motion/reveal";
import { SessionOnboarding } from "@/components/session-onboarding";
import {
  loadOnboarding,
  saveOnboarding,
  type OnboardingAnswers,
} from "@/lib/onboarding";
import {
  createPipelineSession,
  friendlyFetchError,
  runPipelineTurn,
  summarizePipelineSession,
} from "@/lib/pipeline-client";
import type { CrisisLevel, TurnMetrics } from "@/lib/pipeline-types";
import { bubbleIn, metricsPulse, metricValuePop, springBouncy } from "@/lib/motion-presets";

type UiMessage = {
  id: string;
  role: "user" | "emma";
  text: string;
};

const WELCOME: UiMessage = {
  id: "welcome",
  role: "emma",
  text: "Hi — I'm Emma. Type a message to test the pipeline brain: streaming LLM, crisis detection, rolling summaries, and turn metrics.",
};

export function TextPipelineSession() {
  const formId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [onboarding, setOnboarding] = useState<OnboardingAnswers | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMetrics, setLastMetrics] = useState<TurnMetrics | null>(null);
  const [lastCrisis, setLastCrisis] = useState<{
    level: CrisisLevel;
    matched: string[];
  } | null>(null);
  const [summaryPreview, setSummaryPreview] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(id);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    setOnboarding(loadOnboarding());
    setNeedsOnboarding(loadOnboarding() === null);
  }, []);

  useEffect(() => {
    if (needsOnboarding) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const id = await createPipelineSession();
        if (!cancelled) {
          sessionIdRef.current = id;
          setSessionId(id);
        }
      } catch (e) {
        if (!cancelled) setError(friendlyFetchError(e));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsOnboarding]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;

    let sid = sessionIdRef.current;
    if (!sid) {
      try {
        sid = await createPipelineSession();
        sessionIdRef.current = sid;
        setSessionId(sid);
      } catch (e) {
        setError(friendlyFetchError(e));
        return;
      }
    }

    setError(null);
    setDraft("");
    setBusy(true);
    setLastCrisis(null);

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "emma", text: "" },
    ]);

    try {
      await runPipelineTurn(
        {
          sessionId: sid,
          message: text,
          mode: "text",
          onboarding,
        },
        {
        onToken: (token) => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId
                ? { ...msg, text: msg.text + token }
                : msg,
            ),
          );
        },
        onCrisis: (data) =>
          setLastCrisis({
            level: data.level as CrisisLevel,
            matched: data.matched,
          }),
        onSummary: (data) => setSummaryPreview(data.summary || null),
        onSession: (data) => setTurnCount(data.turnNumber),
        onMetrics: (data) => setLastMetrics(data),
      },
      );
    } catch (e) {
      setError(friendlyFetchError(e));
      setMessages((m) => m.filter((msg) => msg.id !== assistantId));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, onboarding]);

  const resetSession = useCallback(async () => {
    setMessages([WELCOME]);
    setLastMetrics(null);
    setLastCrisis(null);
    setSummaryPreview(null);
    setTurnCount(0);
    setError(null);
    setDraft("");
    setSessionSummary(null);
    try {
      const id = await createPipelineSession();
      sessionIdRef.current = id;
      setSessionId(id);
    } catch (e) {
      setError(friendlyFetchError(e));
    }
  }, []);

  const endSession = useCallback(async () => {
    const transcript = messages
      .filter((m) => m.id !== "welcome" && m.text.trim())
      .map((m) => ({
        role: m.role === "emma" ? ("assistant" as const) : ("user" as const),
        content: m.text,
      }));
    if (transcript.length === 0) return;
    setEnding(true);
    try {
      const summary = await summarizePipelineSession(transcript);
      setSessionSummary(summary);
    } catch (e) {
      setError(friendlyFetchError(e));
    } finally {
      setEnding(false);
    }
  }, [messages]);

  if (needsOnboarding) {
    return (
      <div className="voice-chat pipeline-chat">
        <SessionOnboarding
          onComplete={(answers) => {
            saveOnboarding(answers);
            setOnboarding(answers);
            setNeedsOnboarding(false);
            setBooting(true);
          }}
          onSkip={() => {
            setOnboarding(null);
            setNeedsOnboarding(false);
            setBooting(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="voice-chat pipeline-chat">
      {lastCrisis && lastCrisis.level !== "none" ? (
        <CrisisModal
          level={lastCrisis.level === "elevated" ? "elevated" : "imminent"}
          onDismiss={() => setLastCrisis(null)}
        />
      ) : null}
      <header className="voice-chat-header">
        <div className="voice-chat-header-top">
          <div className="voice-chat-header-main">
            <div className="voice-chat-avatar" aria-hidden>
              <span className="logo-mark sm" />
            </div>
            <div>
              <h2 className="voice-chat-title">Emma · Text pipeline</h2>
              <p className="voice-chat-sub">
                <span className="voice-chat-status voice-chat-status-live">
                  {booting ? "Starting…" : "Phase 1 — streaming brain"}
                </span>
              </p>
            </div>
          </div>
          <div className="voice-chat-header-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void resetSession()}
              disabled={busy}
            >
              New session
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void endSession()}
              disabled={busy || ending || turnCount === 0}
            >
              {ending ? "Summarizing…" : "End & summarize"}
            </button>
            <Link href="/session/voice" className="btn btn-primary">
              Voice mode
            </Link>
            <Link href="/" className="btn btn-ghost">
              Home
            </Link>
          </div>
        </div>
      </header>

      <motion.aside
        className="pipeline-metrics"
        aria-label="Turn metrics"
        animate={lastMetrics ? "flash" : "idle"}
        variants={metricsPulse}
        key={lastMetrics?.turnNumber ?? "empty"}
      >
        <h3 className="pipeline-metrics-title">Last turn</h3>
        {lastMetrics ? (
          <dl className="pipeline-metrics-grid">
            {[
              { label: "Turn", value: String(lastMetrics.turnNumber) },
              {
                label: "LLM TTFT",
                value:
                  lastMetrics.llmTtftMs != null
                    ? `${lastMetrics.llmTtftMs} ms`
                    : "—",
              },
              {
                label: "E2E",
                value:
                  lastMetrics.totalMs != null
                    ? `${lastMetrics.totalMs} ms`
                    : "—",
              },
              { label: "Crisis", value: lastMetrics.crisisLevel },
            ].map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <motion.dd
                  variants={metricValuePop}
                  initial="hidden"
                  animate="visible"
                >
                  {row.value}
                </motion.dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="pipeline-metrics-empty">
            {booting ? "Starting session…" : "Send a message to see latencies."}
          </p>
        )}
        <p className="pipeline-metrics-meta">
          Session: {sessionId ? `${sessionId.slice(0, 12)}…` : "…"} · Turns:{" "}
          {turnCount}
        </p>
        {summaryPreview ? (
          <details className="pipeline-summary-preview">
            <summary>Rolling summary (turn {turnCount})</summary>
            <p>{summaryPreview}</p>
          </details>
        ) : null}
        {sessionSummary ? (
          <details className="pipeline-summary-preview" open>
            <summary>Session summary</summary>
            <p>{sessionSummary}</p>
          </details>
        ) : null}
        {lastCrisis && lastCrisis.level !== "none" ? (
          <p className="pipeline-crisis-flag" role="status">
            Crisis: {lastCrisis.level}
          </p>
        ) : null}
      </motion.aside>

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key="error"
            className="voice-chat-error"
            role="alert"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div
        className="voice-chat-messages pipeline-messages"
        ref={scrollRef}
        role="log"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              layout
              className={`voice-chat-row voice-chat-row-${msg.role === "user" ? "user" : "emma"}`}
              variants={bubbleIn}
              initial="hidden"
              animate="visible"
            >
              <div className="voice-chat-bubble">
                <span className="voice-chat-bubble-label">
                  {msg.role === "user" ? "You" : "Emma"}
                </span>
                <p className="voice-chat-bubble-text">
                  {msg.text ||
                    (busy && msg.role === "emma" ? <TypingIndicator /> : "")}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <form
        className="voice-chat-compose pipeline-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage();
        }}
      >
        <label htmlFor={`${formId}-input`} className="sr-only">
          Message
        </label>
        <textarea
          id={`${formId}-input`}
          className="voice-chat-input"
          rows={2}
          placeholder={booting ? "Starting session…" : "Type to Emma…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy || booting}
        />
        <motion.button
          type="submit"
          className="btn btn-primary"
          disabled={busy || booting || !draft.trim()}
          whileHover={busy ? undefined : { y: -4, scale: 1.05 }}
          whileTap={busy ? undefined : { scale: 0.9 }}
          transition={springBouncy}
        >
          {busy ? "Streaming…" : "Send"}
        </motion.button>
      </form>
    </div>
  );
}
