"use server";
import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

export async function registerAccount(formData: FormData) {
  if (!isDatabaseUrlConfigured()) redirect("/register?error=Database setup is required first.");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) redirect("/register?error=Use a valid email and an 8+ character password.");
  if (password !== String(formData.get("confirmPassword") ?? "")) redirect("/register?error=Passwords do not match.");
  try { await prisma.user.create({ data: { email, name: email.split("@")[0], passwordHash: await hash(password, 12) } }); }
  catch { redirect("/register?error=An account with that email may already exist."); }
  redirect("/login?created=1");
}
