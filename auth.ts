import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

const usePrismaAdapter = isDatabaseUrlConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [Credentials({
    name: "Username or email and password",
    credentials: { username: {}, email: {}, identifier: {}, password: {} },
    async authorize(credentials) {
      if (!usePrismaAdapter) return null;
      const identifier = String(
        credentials?.identifier ?? credentials?.username ?? credentials?.email ?? "",
      ).trim().toLowerCase();
      const password = String(credentials?.password ?? "");
      if (!identifier || !password) return null;

      const user = await prisma.user.findFirst({
        where: {
          OR: [{ email: identifier }, { username: identifier }],
        },
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          passwordHash: true,
        },
      });
      if (!user?.passwordHash || !(await compare(password, user.passwordHash))) return null;
      return {
        id: user.id,
        email: user.email ?? user.username ?? null,
        name: user.name?.trim() || user.email || user.username || "User",
      };
    },
  })],
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.name =
          session.user.name?.trim() ||
          (typeof token.name === "string" ? token.name.trim() : "") ||
          (typeof token.email === "string" ? token.email.trim() : "") ||
          null;
      }
      return session;
    },
  },
});
