import {
  allowPipelineAnon,
  createPipelineSession,
  resolvePipelineUserId,
} from "@/lib/pipeline-session-store";

export const runtime = "nodejs";

export async function POST() {
  const userId = await resolvePipelineUserId();
  if (!userId && !allowPipelineAnon()) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const session = await createPipelineSession(userId);
    return Response.json({
      sessionId: session.id,
      turnCount: session.turnCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create session";
    return Response.json({ error: message }, { status: 500 });
  }
}
