import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";

const usePrismaAdapter = isDatabaseUrlConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
