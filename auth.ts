import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

const authConfig = {
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

/**
 * Without a secret, Auth.js throws `MissingSecret` on every request (including
 * middleware), which breaks the whole app (blank / 500). Production must set
 * `AUTH_SECRET`. For local dev, a placeholder keeps the UI working until you
 * add `.env.local`.
 */
function resolveAuthSecret(): string | undefined {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") return undefined;
  return "local-dev-only-set-AUTH_SECRET-in-env-file-please";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: resolveAuthSecret(),
});
