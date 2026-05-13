import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { resolveAuthSecret } from "@/lib/auth-secret";

/**
 * Edge-safe auth config (no Prisma). Middleware must import this file only,
 * never `@/auth`, so Prisma is not bundled into the Edge middleware.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
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
