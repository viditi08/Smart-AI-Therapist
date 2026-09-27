import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { prisma } from "@/lib/prisma";

function safeRedirectTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/session/voice";
  }
  return value;
}

function registrationError(request: Request, message: string, redirectTo: string) {
  const url = new URL("/register", request.url);
  url.searchParams.set("error", message);
  url.searchParams.set("redirectTo", redirectTo);
  return NextResponse.redirect(url, 303);
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));

  if (!isDatabaseUrlConfigured()) {
    return registrationError(
      request,
      "Database setup is required first.",
      redirectTo,
    );
  }

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");

  if (!/^[a-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
    return registrationError(
      request,
      "Use a 3–32 character username and an 8+ character password.",
      redirectTo,
    );
  }

  if (password !== confirmation) {
    return registrationError(request, "Passwords do not match.", redirectTo);
  }

  try {
    await prisma.user.create({
      data: {
        email: username,
        name: username,
        passwordHash: await hash(password, 12),
      },
      select: { id: true },
    });
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code === "P2002") {
      return registrationError(
        request,
        "That username is already taken. Try logging in or choose another username.",
        redirectTo,
      );
    }
    if (code === "P2021" || code === "P2022") {
      return registrationError(
        request,
        "The account database schema is unavailable. Check the deployment database and try again.",
        redirectTo,
      );
    }
    if (code === "P1001" || code === "P1002") {
      return registrationError(
        request,
        "The account database could not be reached. Try again in a moment.",
        redirectTo,
      );
    }
    console.error("Account registration failed", { code: code ?? "unknown" });
    return registrationError(
      request,
      "Could not create the account. Please try again.",
      redirectTo,
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("created", "1");
  loginUrl.searchParams.set("callbackUrl", redirectTo);
  return NextResponse.redirect(loginUrl, 303);
}
