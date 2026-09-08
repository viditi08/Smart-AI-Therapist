import { auth } from "@/auth";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";
import type { PipelineMessage, PipelineSessionState } from "@/lib/pipeline-types";
import type { Prisma } from "@prisma/client";

export function allowPipelineAnon(): boolean {
  return (
    process.env.PIPELINE_ALLOW_ANON === "true" ||
    process.env.GEMINI_FREE_TRIAL_NO_AUTH === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.PIPELINE_REQUIRE_AUTH !== "true")
  );
}

export async function resolvePipelineUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function parseMessages(raw: unknown): PipelineMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: PipelineMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.role !== "user" && o.role !== "assistant") continue;
    if (typeof o.content !== "string") continue;
    const content = o.content.trim();
    if (!content) continue;
    out.push({ role: o.role, content });
  }
  return out;
}

/** In-memory fallback when DATABASE_URL is not configured (local experiments). */
const memorySessions = new Map<string, PipelineSessionState>();

export async function createPipelineSession(
  userId: string | null,
): Promise<PipelineSessionState> {
  if (isDatabaseUrlConfigured()) {
    const row = await prisma.pipelineSession.create({
      data: {
        userId: userId ?? undefined,
        messages: [],
      },
    });
    return {
      id: row.id,
      turnCount: row.turnCount,
      summary: row.summary,
      messages: parseMessages(row.messages),
    };
  }

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const state: PipelineSessionState = {
    id,
    turnCount: 0,
    summary: null,
    messages: [],
  };
  memorySessions.set(id, state);
  return state;
}

export async function loadPipelineSession(
  sessionId: string,
  userId: string | null,
): Promise<PipelineSessionState | null> {
  if (sessionId.startsWith("mem-")) {
    return memorySessions.get(sessionId) ?? null;
  }

  if (!isDatabaseUrlConfigured()) return null;

  const row = await prisma.pipelineSession.findFirst({
    where: {
      id: sessionId,
      ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    turnCount: row.turnCount,
    summary: row.summary,
    messages: parseMessages(row.messages),
  };
}

export async function savePipelineSession(
  state: PipelineSessionState,
  userId: string | null,
): Promise<void> {
  if (state.id.startsWith("mem-")) {
    memorySessions.set(state.id, state);
    return;
  }

  if (!isDatabaseUrlConfigured()) return;

  await prisma.pipelineSession.updateMany({
    where: {
      id: state.id,
      ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
    },
    data: {
      turnCount: state.turnCount,
      summary: state.summary,
      messages: state.messages as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function recordTurnMetric(input: {
  sessionId: string;
  turnNumber: number;
  crisisLevel: string;
  llmTtftMs: number | null;
  llmTotalMs: number | null;
  totalMs: number | null;
}): Promise<void> {
  if (input.sessionId.startsWith("mem-")) return;
  if (!isDatabaseUrlConfigured()) return;

  await prisma.pipelineTurnMetric.create({
    data: {
      sessionId: input.sessionId,
      turnNumber: input.turnNumber,
      crisisLevel: input.crisisLevel,
      llmTtftMs: input.llmTtftMs,
      llmTotalMs: input.llmTotalMs,
      totalMs: input.totalMs,
    },
  });
}
