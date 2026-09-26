"use server";
import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export async function registerAccount(formData: FormData) {
  if (!isDatabaseUrlConfigured()) redirect("/register?error=Database setup is required first.");
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!/^[a-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
    redirect("/register?error=Use a 3–32 character username and an 8+ character password.");
  }
  if (password !== String(formData.get("confirmPassword") ?? "")) redirect("/register?error=Passwords do not match.");
  try {
    await prisma.user.create({
      // Reuse the database's existing unique credential identifier. The app
      // treats this value as a username and never exposes it as an email.
      data: { email: username, name: username, passwordHash: await hash(password, 12) },
      select: { id: true },
    });
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code === "P2002") {
      redirect("/register?error=That username is already taken. Try logging in or choose another username.");
    }
    if (code === "P2021" || code === "P2022") {
      redirect("/register?error=The account database schema is unavailable. Check the deployment database and try again.");
    }
    if (code === "P1001" || code === "P1002") {
      redirect("/register?error=The account database could not be reached. Try again in a moment.");
    }
    console.error("Account registration failed", { code: code ?? "unknown" });
    redirect("/register?error=Could not create the account. Please try again.");
  }
  redirect("/login?created=1");
}
