import { NextResponse } from "next/server";

/**
 * Example Route Handler — runs on the Node.js server (dev & Node hosting).
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "emma-landing",
    runtime: "nodejs",
    time: new Date().toISOString(),
  });
}
