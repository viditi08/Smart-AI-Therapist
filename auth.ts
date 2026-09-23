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
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username },
            // Keep existing email/password accounts usable after this change.
            { email: username },
          ],
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
