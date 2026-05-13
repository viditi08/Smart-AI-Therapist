"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getSavedSession,
  type SavedSessionRecord,
} from "@/lib/session-history-storage";

type Props = { sessionId: string };

export function SavedSessionViewer({ sessionId }: Props) {
  const [record, setRecord] = useState<SavedSessionRecord | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = getSavedSession(sessionId);
      if (!cancelled) setRecord(found ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (record === undefined) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card-wide">
          <p className="text-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card-wide">
          <Link className="auth-back" href="/account">
            ← Back to account
          </Link>
          <h1 className="auth-title">Conversation not found</h1>
          <p className="auth-lead text-muted">
            It may have been deleted or saved under a different Google account on this
            browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide saved-session-view">
        <Link className="auth-back" href="/account">
          ← Back to saved conversations
        </Link>
        <h1 className="auth-title saved-session-view-title">{record.title}</h1>
        <p className="saved-session-view-savedat text-muted">
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
    </div>
  );
}
