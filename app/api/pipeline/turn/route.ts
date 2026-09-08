import {
  CRISIS_ESCALATION_REPLY,
  detectCrisis,
} from "@/lib/crisis-detection";
import {
  buildContextPrefix,
  getEmmaTextSystemInstruction,
  maybeRollSummary,
} from "@/lib/emma-text-pipeline";
import { streamGeminiText } from "@/lib/gemini-text-stream";
import {
  allowPipelineAnon,
  loadPipelineSession,
  recordTurnMetric,
  resolvePipelineUserId,
  savePipelineSession,
} from "@/lib/pipeline-session-store";
import { encodeSse, sseResponse } from "@/lib/pipeline-sse";
import type { TurnMetrics } from "@/lib/pipeline-types";

export const runtime = "nodejs";

const MAX_MESSAGE_CHARS = 8_000;

export async function POST(req: Request) {
  const userId = await resolvePipelineUserId();
  if (!userId && !allowPipelineAnon()) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const sessionId = typeof o.sessionId === "string" ? o.sessionId.trim() : "";
  const message = typeof o.message === "string" ? o.message.trim() : "";

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: "Message too long" }, { status: 400 });
  }

  const state = await loadPipelineSession(sessionId, userId);
  if (!state) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const turnStarted = performance.now();
  const turnNumber = state.turnCount + 1;
  const crisis = detectCrisis(message);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (payload: Parameters<typeof encodeSse>[0]) => {
        controller.enqueue(encoder.encode(encodeSse(payload)));
      };

      try {
        push({
          event: "session",
          data: { sessionId: state.id, turnNumber },
        });

        if (crisis.level !== "none") {
          push({
            event: "crisis",
            data: { level: crisis.level, matched: crisis.matched },
          });
        }

        state.messages.push({ role: "user", content: message });
        state.turnCount = turnNumber;

        let assistantText = "";
        let llmTtftMs: number | null = null;
        let llmTotalMs: number | null = null;

        if (crisis.level === "imminent") {
          assistantText = CRISIS_ESCALATION_REPLY;
          for (const word of assistantText.split(/(\s+)/)) {
            if (!word) continue;
            push({ event: "token", data: { text: word } });
            await new Promise((r) => setTimeout(r, 8));
          }
        } else {
          const llmStarted = performance.now();
          const crisisNote =
            crisis.level === "elevated"
              ? "The user's message may indicate elevated distress. Prioritize safety, validation, and gentle encouragement to reach human crisis support if needed. Do not minimize."
              : undefined;

          const gen = streamGeminiText({
            systemInstruction: getEmmaTextSystemInstruction(),
            messages: state.messages,
            contextPrefix: buildContextPrefix(state.summary),
            crisisNote,
          });

          for await (const chunk of gen) {
            if (chunk.isFirst) {
              llmTtftMs = Math.round(performance.now() - llmStarted);
            }
            assistantText += chunk.text;
            push({ event: "token", data: { text: chunk.text } });
          }
          llmTotalMs = Math.round(performance.now() - llmStarted);
        }

        state.messages.push({ role: "assistant", content: assistantText });

        const rolled = await maybeRollSummary(
          state.turnCount,
          state.summary,
          state.messages,
        );
        if (rolled.updated) {
          state.summary = rolled.summary;
          state.messages = rolled.messages;
          push({
            event: "summary",
            data: {
              summary: rolled.summary ?? "",
              turnNumber: state.turnCount,
            },
          });
        }

        await savePipelineSession(state, userId);

        const totalMs = Math.round(performance.now() - turnStarted);
        const metrics: TurnMetrics = {
          turnNumber,
          crisisLevel: crisis.level,
          llmTtftMs,
          llmTotalMs,
          totalMs,
        };

        await recordTurnMetric({
          sessionId: state.id,
          turnNumber,
          crisisLevel: crisis.level,
          llmTtftMs,
          llmTotalMs,
          totalMs,
        });

        push({ event: "metrics", data: metrics });
        push({ event: "done", data: {} });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Turn failed";
        push({ event: "error", data: { message: msg } });
      } finally {
        controller.close();
      }
    },
  });

  return sseResponse(stream);
}
