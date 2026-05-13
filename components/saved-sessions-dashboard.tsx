"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  deleteSavedSession,
  getClientSessionEmail,
  listSavedSessions,
  type SavedSessionRecord,
} from "@/lib/session-history-storage";

type ServerSessionSummary = {
  id: string;
  title: string;
  savedAt: string;
  source: "server";
};

type DashboardRow = (SavedSessionRecord & { source: "local" }) | ServerSessionSummary;

function mergeRows(
  server: ServerSessionSummary[],
  local: SavedSessionRecord[],
): DashboardRow[] {
  const localRows: DashboardRow[] = local.map((s) => ({ ...s, source: "local" }));
  const merged = [...server, ...localRows];
  merged.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
  return merged;
}

export function SavedSessionsDashboard() {
  const [email, setEmail] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardRow[]>([]);

  const refresh = useCallback(async () => {
    const local = listSavedSessions();
    try {
      const res = await fetch("/api/chats", { credentials: "same-origin" });
      if (res.ok) {
        const server = (await res.json()) as ServerSessionSummary[];
        setRows(mergeRows(server, local));
        return;
      }
    } catch {
      /* offline */
    }
    setRows(mergeRows([], local));
  }, []);

  useEffect(() => {
    void getClientSessionEmail().then(setEmail);
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (row: DashboardRow) => {
      if (row.source === "server") {
        try {
          const res = await fetch(`/api/chats/${encodeURIComponent(row.id)}`, {
            method: "DELETE",
            credentials: "same-origin",
          });
          if (!res.ok && res.status !== 404) return;
        } catch {
          return;
        }
      } else {
        deleteSavedSession(row.id);
      }
      void refresh();
    },
    [refresh],
  );

  return (
    <section className="saved-sessions-section" aria-labelledby="saved-sessions-heading">
      <h2 id="saved-sessions-heading" className="saved-sessions-title">
        Saved conversations
      </h2>
      <p className="saved-sessions-note text-muted">
        {email
          ? `Signed in as ${email}. Account saves sync here; “This device” entries stay in this browser only.`
          : "Sign in to save chats to your account. Without signing in, saves stay in this browser only."}
      </p>
      {rows.length === 0 ? (
        <p className="saved-sessions-empty">
          No saved sessions yet. During a chat, use{" "}
          <strong>Save conversation</strong> on the session page, then return here.
        </p>
      ) : (
        <ul className="saved-sessions-list">
          {rows.map((s) => (
            <li key={`${s.source}-${s.id}`} className="saved-sessions-row">
              <Link href={`/account/sessions/${encodeURIComponent(s.id)}`} className="saved-sessions-link">
                <span className="saved-sessions-row-title">{s.title}</span>
                <span className="saved-sessions-row-meta text-muted">
                  {new Date(s.savedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {s.source === "local" ? " · This device" : ""}
                </span>
              </Link>
              <button
                type="button"
                className="btn btn-ghost saved-sessions-delete"
                onClick={() => void handleDelete(s)}
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
