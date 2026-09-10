import { getSession } from "@/lib/session";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";
import type { SavedChatMessage, SavedSessionRecord } from "@/lib/session-history-storage";

export const runtime = "nodejs";

function isMessageArray(x: unknown): x is SavedChatMessage[] {
  if (!Array.isArray(x)) return false;
  return x.every(
    (m) =>
      m &&
      typeof m === "object" &&
      typeof (m as SavedChatMessage).id === "string" &&
      ((m as SavedChatMessage).role === "user" || (m as SavedChatMessage).role === "emma") &&
      typeof (m as SavedChatMessage).text === "string",
  );
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseUrlConfigured()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await ctx.params;
  const row = await prisma.chatSession.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!row) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const messages = row.messages;
  if (!isMessageArray(messages)) {
    return Response.json({ error: "Corrupt transcript" }, { status: 500 });
  }

  const record: SavedSessionRecord = {
    id: row.id,
    title: row.title,
    savedAt: row.savedAt.toISOString(),
    messages,
  };

  return Response.json(record);
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseUrlConfigured()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await ctx.params;
  const result = await prisma.chatSession.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (result.count === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
