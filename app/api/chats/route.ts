import { auth } from "@/auth";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";
import { deriveConversationTitle } from "@/lib/session-history-storage";
import { validateChatMessages } from "@/lib/validate-chat-messages";

export const runtime = "nodejs";

const TITLE_MAX = 512;

function truncateTitle(value: string): string {
  if (value.length <= TITLE_MAX) return value;
  return `${value.slice(0, TITLE_MAX - 1)}…`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseUrlConfigured()) {
    return Response.json([]);
  }

  const rows = await prisma.chatSession.findMany({
    where: { userId: session.user.id },
    orderBy: { savedAt: "desc" },
    take: 50,
    select: { id: true, title: true, savedAt: true },
  });

  return Response.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      savedAt: r.savedAt.toISOString(),
      source: "server" as const,
    })),
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseUrlConfigured()) {
    return Response.json(
      {
        error:
          "Server database is not configured (missing DATABASE_URL). Add it to .env.local, run prisma migrate deploy, and restart the dev server.",
      },
      { status: 503 },
    );
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
  const messages = validateChatMessages(o.messages);
  if (!messages) {
    return Response.json(
      { error: "Invalid or empty messages, or transcript too large." },
      { status: 400 },
    );
  }

  const titleOverride =
    typeof o.title === "string" && o.title.trim() ? o.title.trim() : undefined;
  const title = truncateTitle(titleOverride ?? deriveConversationTitle(messages));

  const row = await prisma.chatSession.create({
    data: {
      userId: session.user.id,
      title,
      messages,
    },
  });

  return Response.json({
    id: row.id,
    title: row.title,
    savedAt: row.savedAt.toISOString(),
    source: "server" as const,
  });
}
