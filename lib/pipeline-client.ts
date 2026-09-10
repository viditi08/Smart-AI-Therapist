import type { TurnMetrics } from "@/lib/pipeline-types";

/** Client helpers for pipeline session + turn APIs. */

export class PipelineFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PipelineFetchError";
  }
}

export function friendlyFetchError(err: unknown): string {
  if (err instanceof PipelineFetchError) return err.message;
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return "Cannot reach the server. Run npm run dev and keep that terminal open.";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}

export async function createPipelineSession(): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/pipeline/session", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    throw new PipelineFetchError(
      "Cannot reach the server. Run npm run dev and keep that terminal open.",
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new PipelineFetchError(`Server error (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const err = raw as { error?: string };
    throw new PipelineFetchError(
      err.error ?? `Session failed (HTTP ${res.status})`,
      res.status,
    );
  }

  const body = raw as { sessionId?: string };
  if (!body.sessionId) {
    throw new PipelineFetchError("Server did not return a session id.");
  }
  return body.sessionId;
}

export type PipelineTurnHandlers = {
  onToken?: (text: string) => void;
  onSentence?: (text: string, index: number) => void;
  onCrisis?: (data: { level: string; matched: string[] }) => void;
  onSummary?: (data: { summary: string; turnNumber: number }) => void;
  onSession?: (data: { sessionId: string; turnNumber: number }) => void;
  onMetrics?: (data: TurnMetrics) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
};

export type PipelineTurnInput = {
  sessionId: string;
  message: string;
  mode?: "text" | "voice";
  onboarding?: Record<string, string> | null;
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

export async function runPipelineTurn(
  input: PipelineTurnInput | string,
  messageOrHandlers?: string | PipelineTurnHandlers,
  maybeHandlers?: PipelineTurnHandlers,
): Promise<void> {
  const turn: PipelineTurnInput =
    typeof input === "string"
      ? {
          sessionId: input,
          message: typeof messageOrHandlers === "string" ? messageOrHandlers : "",
        }
      : input;
  const handlers: PipelineTurnHandlers =
    typeof input === "string"
      ? (maybeHandlers ?? {})
      : ((messageOrHandlers as PipelineTurnHandlers | undefined) ?? {});

  let res: Response;
  try {
    res = await fetch("/api/pipeline/turn", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: turn.sessionId,
        message: turn.message,
        mode: turn.mode ?? "text",
        onboarding: turn.onboarding ?? undefined,
      }),
    });
  } catch {
    throw new PipelineFetchError(
      "Cannot reach the server. Run npm run dev and keep that terminal open.",
    );
  }

  if (!res.ok) {
    let errMsg = `Turn failed (HTTP ${res.status})`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) errMsg = err.error;
    } catch {
      /* ignore */
    }
    throw new PipelineFetchError(errMsg, res.status);
  }

  if (!res.body) throw new PipelineFetchError("No response stream from server.");

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

      try {
        if (parsed.event === "token") {
          const { text } = JSON.parse(parsed.data) as { text: string };
          handlers.onToken?.(text);
        } else if (parsed.event === "sentence") {
          const { text, index } = JSON.parse(parsed.data) as {
            text: string;
            index: number;
          };
          handlers.onSentence?.(text, index);
        } else if (parsed.event === "crisis") {
          handlers.onCrisis?.(JSON.parse(parsed.data));
        } else if (parsed.event === "summary") {
          handlers.onSummary?.(JSON.parse(parsed.data));
        } else if (parsed.event === "session") {
          handlers.onSession?.(JSON.parse(parsed.data));
        } else if (parsed.event === "metrics") {
          handlers.onMetrics?.(JSON.parse(parsed.data) as TurnMetrics);
        } else if (parsed.event === "error") {
          const { message: msg } = JSON.parse(parsed.data) as { message: string };
          handlers.onError?.(msg);
          throw new PipelineFetchError(msg);
        } else if (parsed.event === "done") {
          handlers.onDone?.();
        }
      } catch (e) {
        if (e instanceof PipelineFetchError) throw e;
        /* skip malformed chunk */
      }
    }
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PipelineFetchError(
      "Cannot reach the server. Run npm run dev and keep that terminal open.",
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new PipelineFetchError(`Server error (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const err = raw as { error?: string };
    throw new PipelineFetchError(err.error ?? `Request failed (HTTP ${res.status})`, res.status);
  }

  return raw as T;
}

export async function summarizePipelineSession(
  transcript: { role: "user" | "assistant" | "emma"; content?: string; text?: string }[],
): Promise<string> {
  const raw = await postJson<{ summary?: string }>("/api/pipeline/summarize", {
    transcript,
  });
  return raw.summary?.trim() || "A summary couldn't be generated for this session.";
}
