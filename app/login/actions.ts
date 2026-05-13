"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isGoogleOAuthConfigured } from "@/lib/google-auth-env";

function safeRedirectTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/account";
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
