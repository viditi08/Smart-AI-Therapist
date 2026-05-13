/** True when Google OAuth client env vars are set (server-side only). */
export function isGoogleOAuthConfigured(): boolean {
  const id = process.env.AUTH_GOOGLE_ID?.trim();
  const secret = process.env.AUTH_GOOGLE_SECRET?.trim();
  return Boolean(id && secret);
}
