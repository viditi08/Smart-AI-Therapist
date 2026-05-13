"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  deleteSavedSession,
  getClientSessionEmail,
  listSavedSessions,
  type SavedSessionRecord,
} from "@/lib/session-history-storage";

export function SavedSessionsDashboard() {
  const [email, setEmail] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SavedSessionRecord[]>([]);

  const refresh = useCallback(() => {
    setSessions(listSavedSessions());
  }, []);

  useEffect(() => {
    void getClientSessionEmail().then(setEmail);
    refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    (id: string) => {
      deleteSavedSession(id);
      refresh();
    },
    [refresh],
  );

  return (
    <section className="saved-sessions-section" aria-labelledby="saved-sessions-heading">
      <h2 id="saved-sessions-heading" className="saved-sessions-title">
        Saved conversations
      </h2>
      <p className="saved-sessions-note text-muted">
        Stored in this browser only (not uploaded to our servers).{" "}
        {email ? `You are signed in as ${email}.` : null}
      </p>
      {sessions.length === 0 ? (
        <p className="saved-sessions-empty">
          No saved sessions yet. During a chat, use{" "}
          <strong>Save conversation</strong> on the session page, then return here.
        </p>
      ) : (
        <ul className="saved-sessions-list">
          {sessions.map((s) => (
            <li key={s.id} className="saved-sessions-row">
              <Link href={`/account/sessions/${encodeURIComponent(s.id)}`} className="saved-sessions-link">
                <span className="saved-sessions-row-title">{s.title}</span>
                <span className="saved-sessions-row-meta text-muted">
                  {new Date(s.savedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </Link>
              <button
                type="button"
                className="btn btn-ghost saved-sessions-delete"
                onClick={() => handleDelete(s.id)}
                aria-label={`Delete saved conversation ${s.title}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
