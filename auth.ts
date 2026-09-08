import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

const usePrismaAdapter = isDatabaseUrlConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [...authConfig.providers, Credentials({
    name: "Email and password",
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      if (!usePrismaAdapter) return null;
      const email = String(credentials?.email ?? "").trim().toLowerCase();
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash || !(await compare(password, user.passwordHash))) return null;
      return { id: user.id, email: user.email, name: user.name };
    },
  })],
  ...(usePrismaAdapter ? { adapter: PrismaAdapter(prisma) } : {}),
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
