import { AuthError } from "next-auth";
import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

function safeRedirectTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/session/voice";
  }
  return value;
}

function loginError(request: Request, error: string, redirectTo: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  url.searchParams.set("callbackUrl", redirectTo);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));

  if (!isDatabaseUrlConfigured()) {
    return loginError(request, "DatabaseRequired", redirectTo);
  }

  try {
    const identifier = String(
      formData.get("identifier") ?? formData.get("username") ?? formData.get("email") ?? "",
    ).trim();

    const result = await signIn("credentials", {
      identifier,
      username: identifier,
      email: identifier,
      password: String(formData.get("password") ?? ""),
      redirect: false,
      redirectTo,
    });
    const resultUrl = typeof result === "string" ? new URL(result, request.url) : null;
    if (resultUrl?.searchParams.has("error")) {
      return loginError(request, "InvalidCredentials", redirectTo);
    }
    return NextResponse.redirect(new URL(redirectTo, request.url), 303);
  } catch (error) {
    if (error instanceof AuthError) {
      return loginError(request, "InvalidCredentials", redirectTo);
    }
    throw error;
  }
}
