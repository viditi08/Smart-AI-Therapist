import type { TurnMetrics } from "@/lib/pipeline-types";

/** Server-Sent Events helpers for the pipeline turn stream. */

export type PipelineSseEvent =
  | { event: "session"; data: { sessionId: string; turnNumber: number } }
  | { event: "crisis"; data: { level: string; matched: string[] } }
  | { event: "token"; data: { text: string } }
  | { event: "sentence"; data: { text: string; index: number } }
  | { event: "summary"; data: { summary: string; turnNumber: number } }
  | { event: "metrics"; data: TurnMetrics }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: Record<string, never> };

export function encodeSse(payload: PipelineSseEvent): string {
  return `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
