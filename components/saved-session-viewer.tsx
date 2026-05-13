"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getSavedSession,
  type SavedSessionRecord,
} from "@/lib/session-history-storage";
import { isBrowserLocalSessionId } from "@/lib/validate-chat-messages";

type Props = { sessionId: string };

export function SavedSessionViewer({ sessionId }: Props) {
  const [record, setRecord] = useState<SavedSessionRecord | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (isBrowserLocalSessionId(sessionId)) {
        const found = getSavedSession(sessionId);
        if (!cancelled) setRecord(found ?? null);
        return;
      }

      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(sessionId)}`, {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as SavedSessionRecord;
          setRecord(data);
          return;
        }
      } catch {
        if (!cancelled) setRecord(null);
        return;
      }

      if (!cancelled) setRecord(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (record === undefined) {
    return (
      <div className="dashboard-panel">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="dashboard-panel">
        <Link className="dashboard-back-link" href="/account">
          ← Back to dashboard
        </Link>
        <h1 className="dashboard-page-title">Conversation not found</h1>
        <p className="dashboard-page-lead text-muted">
          It may have been deleted, or it was saved on another device or browser. Try the
          list from your dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-panel dashboard-panel-thread">
      <Link className="dashboard-back-link" href="/account">
        ← Back to saved conversations
      </Link>
      <h1 className="dashboard-thread-title">{record.title}</h1>
      <p className="dashboard-thread-meta text-muted">
        Saved{" "}
        {new Date(record.savedAt).toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "short",
        })}
      </p>
      <div className="saved-session-view-thread" role="log">
          {record.messages.map((msg) => (
            <div
              key={msg.id}
              className={`voice-chat-row voice-chat-row-${msg.role} saved-session-view-row`}
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
    </div>
  );
}
