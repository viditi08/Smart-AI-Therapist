"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

function safeRedirectTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/session/voice";
  }
  return value;
}

export async function loginWithCredentials(formData: FormData) {
  if (!isDatabaseUrlConfigured()) redirect("/login?error=DatabaseRequired");
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  try {
    await signIn("credentials", {
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=InvalidCredentials");
    }
    throw error;
  }
}
