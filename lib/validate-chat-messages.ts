import type { SavedChatMessage } from "@/lib/session-history-storage";

const MAX_TOTAL_CHARS = 400_000;

export function validateChatMessages(raw: unknown): SavedChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SavedChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string") return null;
    if (o.role !== "user" && o.role !== "emma") return null;
    if (typeof o.text !== "string") return null;
    const text = o.text.trim();
    if (!text) continue;
    out.push({ id: o.id, role: o.role, text });
  }
  if (out.length === 0) return null;
  const chars = out.reduce((n, m) => n + m.text.length, 0);
  if (chars > MAX_TOTAL_CHARS) return null;
  return out;
}

export function isBrowserLocalSessionId(id: string): boolean {
  return id.startsWith("sess-");
}
