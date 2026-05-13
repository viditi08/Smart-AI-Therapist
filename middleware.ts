import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/** Edge-safe: no Prisma / no `@/auth` import. */
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
