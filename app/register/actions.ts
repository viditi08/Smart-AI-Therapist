"use server";
import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

export async function registerAccount(formData: FormData) {
  if (!isDatabaseUrlConfigured()) redirect("/register?error=Database setup is required first.");
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!/^[a-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
    redirect("/register?error=Use a 3–32 character username and an 8+ character password.");
  }
  if (password !== String(formData.get("confirmPassword") ?? "")) redirect("/register?error=Passwords do not match.");
  try { await prisma.user.create({ data: { username, name: username, passwordHash: await hash(password, 12) } }); }
  catch { redirect("/register?error=That username is already taken."); }
  redirect("/login?created=1");
}
