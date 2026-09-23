import type { NextAuthConfig } from "next-auth";
import { resolveAuthSecret } from "@/lib/auth-secret";

// Vercel already provides the canonical deployment host. Prefer it over an
// accidentally copied local AUTH_URL so production credential callbacks stay
// on the deployed app.
const vercelHost =
  process.env.VERCEL_ENV === "production"
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
    : process.env.VERCEL_URL;
if (vercelHost) {
  const host = vercelHost.replace(/^https?:\/\//, "").split("/")[0];
  process.env.AUTH_URL = `https://${host}`;
}

/**
 * Edge-safe auth config (no Prisma). Middleware must import this file only,
 * never `@/auth`, so Prisma is not bundled into the Edge middleware.
 */
export const authConfig = {
  providers: [],
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  secret: resolveAuthSecret(),
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/account")) {
        return !!auth?.user;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
