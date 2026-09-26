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
    name: "Username and password",
    credentials: { username: {}, password: {} },
    async authorize(credentials) {
      if (!usePrismaAdapter) return null;
      const username = String(credentials?.username ?? "").trim().toLowerCase();
      const password = String(credentials?.password ?? "");
      if (!username || !password) return null;
      // The existing unique email column is the credential identifier. It can
      // hold either a username for new accounts or an email for legacy ones,
      // so production does not depend on a separate username migration.
      const user = await prisma.user.findUnique({
        where: { email: username },
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
        },
      });
      if (!user?.passwordHash || !(await compare(password, user.passwordHash))) return null;
      return { id: user.id, email: user.email, name: user.name };
    },
  })],
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
