"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isGoogleOAuthConfigured } from "@/lib/google-auth-env";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

function safeRedirectTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/session/voice";
  }
  return value;
}

export async function loginWithGoogle(formData: FormData) {
  if (!isGoogleOAuthConfigured()) {
    redirect("/login?error=MissingGoogleOAuth");
  }
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  await signIn("google", { redirectTo });
}

export async function loginWithCredentials(formData: FormData) {
  if (!isDatabaseUrlConfigured()) redirect("/login?error=DatabaseRequired");
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  try {
    await signIn("credentials", { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? ""), redirectTo });
  } catch {
    redirect("/login?error=InvalidCredentials");
  }
}
