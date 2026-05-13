"use server";

import { signIn } from "@/auth";

function safeRedirectTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/account";
  }
  return value;
}

export async function loginWithGoogle(formData: FormData) {
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  await signIn("google", { redirectTo });
}
