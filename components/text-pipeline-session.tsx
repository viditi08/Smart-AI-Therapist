"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { TypingIndicator } from "@/components/motion/reveal";
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
  text: "Hi — I'm Emma. This is the text pipeline (Phase 1): streaming LLM, crisis detection, rolling summaries every 6 turns, and turn metrics. Type a message to begin.",
};

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
}

export function TextPipelineSession() {
  const formId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await fetch("/api/pipeline/session", {
      method: "POST",
      credentials: "include",
    });
    const raw: unknown = await res.json();
    if (!res.ok) {
      const err = raw as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const body = raw as { sessionId: string };
    setSessionId(body.sessionId);
    return body.sessionId;
  }, [sessionId]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;

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
      const sid = await ensureSession();
      const res = await fetch("/api/pipeline/turn", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, message: text }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const parsed = parseSseBlock(part);
          if (!parsed) continue;

          if (parsed.event === "token") {
            const { text: token } = JSON.parse(parsed.data) as { text: string };
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, text: msg.text + token }
                  : msg,
              ),
            );
          }

          if (parsed.event === "crisis") {
            const data = JSON.parse(parsed.data) as {
              level: CrisisLevel;
              matched: string[];
            };
            setLastCrisis(data);
          }

          if (parsed.event === "summary") {
            const data = JSON.parse(parsed.data) as { summary: string };
            setSummaryPreview(data.summary || null);
          }

          if (parsed.event === "session") {
            const data = JSON.parse(parsed.data) as { turnNumber: number };
            setTurnCount(data.turnNumber);
          }

          if (parsed.event === "metrics") {
            setLastMetrics(JSON.parse(parsed.data) as TurnMetrics);
          }

          if (parsed.event === "error") {
            const data = JSON.parse(parsed.data) as { message: string };
            throw new Error(data.message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      setMessages((m) => m.filter((msg) => msg.id !== assistantId));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, ensureSession]);

  const resetSession = useCallback(async () => {
    setSessionId(null);
    setMessages([WELCOME]);
    setLastMetrics(null);
    setLastCrisis(null);
    setSummaryPreview(null);
    setTurnCount(0);
    setError(null);
    setDraft("");
  }, []);

  return (
    <div className="voice-chat pipeline-chat">
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
                  Phase 1 — streaming brain
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
            <Link href="/session" className="btn btn-ghost">
              Voice (Live)
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
                label: "LLM total",
                value:
                  lastMetrics.llmTotalMs != null
                    ? `${lastMetrics.llmTotalMs} ms`
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
          <p className="pipeline-metrics-empty">Send a message to see latencies.</p>
        )}
        <p className="pipeline-metrics-meta">
          Session: {sessionId ? `${sessionId.slice(0, 12)}…` : "not started"} · Turns: {turnCount}
        </p>
        {lastCrisis && lastCrisis.level !== "none" ? (
          <p className="pipeline-crisis-flag" role="status">
            Crisis layer: {lastCrisis.level}
            {lastCrisis.matched.length > 0
              ? ` (${lastCrisis.matched.join(", ")})`
              : ""}
          </p>
        ) : null}
        {summaryPreview ? (
          <details className="pipeline-summary-preview">
            <summary>Rolling summary (turn {turnCount})</summary>
            <p>{summaryPreview}</p>
          </details>
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
              exit="exit"
            >
              <motion.div
                className="voice-chat-bubble"
                whileHover={{ y: -4, scale: 1.02, rotate: msg.role === "emma" ? -0.6 : 0.6 }}
                whileTap={{ scale: 0.98 }}
                transition={springBouncy}
              >
                <span className="voice-chat-bubble-label">
                  {msg.role === "user" ? "You" : "Emma"}
                </span>
                <p className="voice-chat-bubble-text">
                  {msg.text ||
                    (busy && msg.role === "emma" ? <TypingIndicator /> : "")}
                </p>
              </motion.div>
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
          placeholder="Type to Emma…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <motion.button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !draft.trim()}
          whileHover={busy ? undefined : { y: -4, scale: 1.05 }}
          whileTap={busy ? undefined : { scale: 0.9, y: 2 }}
          transition={springBouncy}
        >
          {busy ? "Streaming…" : "Send"}
        </motion.button>
      </form>
    </div>
  );
}
