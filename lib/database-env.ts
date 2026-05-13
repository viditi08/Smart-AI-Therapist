/** True when Prisma can connect (Auth.js adapter + saved chats need this). */
export function isDatabaseUrlConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
