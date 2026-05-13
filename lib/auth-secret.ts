/**
 * Shared by edge middleware (`auth.config`) and Node `auth.ts`.
 * Without a secret, Auth.js throws `MissingSecret` on every request.
 */
export function resolveAuthSecret(): string | undefined {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") return undefined;
  return "local-dev-only-set-AUTH_SECRET-in-env-file-please";
}
