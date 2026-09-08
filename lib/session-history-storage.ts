/**
 * Persists saved chat transcripts in localStorage (this browser only — not a server backup).
 */

export type SavedChatMessage = {
  id: string;
  role: "user" | "emma";
  text: string;
};

export type SavedSessionRecord = {
  id: string;
  savedAt: string;
  title: string;
  messages: SavedChatMessage[];
};

const STORAGE_KEY = "emma.savedSessions.v1";
const MAX_SESSIONS = 50;
const MAX_TOTAL_CHARS = 400_000;

export async function getClientSessionEmail(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { email?: string | null } | null } | null;
    const email = data?.user?.email?.trim();
    return email ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

function parseList(raw: string | null): SavedSessionRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedSessionRecord);
  } catch {
    return [];
  }
}

function isSavedSessionRecord(x: unknown): x is SavedSessionRecord {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.savedAt === "string" &&
    typeof o.title === "string" &&
    Array.isArray(o.messages)
  );
}

export function deriveConversationTitle(messages: SavedChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  if (firstUser) {
    const line = firstUser.text.trim().split(/\r?\n/)[0] ?? "";
    const short = line.length > 72 ? `${line.slice(0, 69)}…` : line;
    if (short) return short;
  }
  return `Conversation · ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

function charCount(messages: SavedChatMessage[]): number {
  return messages.reduce((n, m) => n + m.text.length, 0);
}

export function listSavedSessions(): SavedSessionRecord[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  const list = parseList(raw);
  return list.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
}

export function getSavedSession(id: string): SavedSessionRecord | null {
  return listSavedSessions().find((s) => s.id === id) ?? null;
}

export function deleteSavedSession(id: string): void {
  if (typeof window === "undefined") return;
  const next = listSavedSessions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function saveConversation(
  messages: SavedChatMessage[],
  titleOverride?: string,
): { ok: true; record: SavedSessionRecord } | { ok: false; error: string } {
  if (typeof window === "undefined") {
    return { ok: false, error: "Save is only available in the browser." };
  }
  const trimmed = messages
    .map((m) => ({ ...m, text: m.text.trim() }))
    .filter((m) => m.text.length > 0);
  if (trimmed.length === 0) {
    return { ok: false, error: "Nothing to save yet." };
  }
  if (charCount(trimmed) > MAX_TOTAL_CHARS) {
    return { ok: false, error: "This conversation is too long to save in the browser." };
  }
  const record: SavedSessionRecord = {
    id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    savedAt: new Date().toISOString(),
    title: titleOverride?.trim() || deriveConversationTitle(trimmed),
    messages: trimmed,
  };
  const prev = listSavedSessions();
  const next = [record, ...prev.filter((s) => s.id !== record.id)].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, error: "Could not write to storage (quota or private mode)." };
  }
  return { ok: true, record };
}
