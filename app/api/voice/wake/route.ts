import { voiceBackendUrl } from "@/lib/voice-backend";

export const runtime = "nodejs";
export const maxDuration = 15;

async function pingBackend() {
  const backend = voiceBackendUrl();
  const response = await fetch(`${backend}/health`, {
    method: "HEAD",
    cache: "no-store",
  });
  return { ok: response.ok, status: response.status, backend };
}

export async function GET() {
  try {
    return Response.json(await pingBackend());
  } catch {
    return Response.json(
      { ok: false, detail: "Voice server did not answer." },
      { status: 502 },
    );
  }
}

export const HEAD = GET;
