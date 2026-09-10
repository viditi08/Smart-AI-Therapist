import type { Session } from "next-auth";
import { auth } from "@/auth";

/**
 * A cookie signed with a previous AUTH_SECRET throws JWTSessionError on decrypt.
 * Treat any unreadable session as signed out so a stale cookie cannot break rendering.
 */
export async function getSession(): Promise<Session | null> {
  try {
    return await auth();
  } catch {
    return null;
  }
}
