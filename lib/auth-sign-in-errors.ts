/** Maps Auth.js / NextAuth `error` query values to short user-facing copy. */
export function signInErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    Configuration:
      "Sign-in is not configured correctly on the server (check AUTH_SECRET and Google OAuth credentials).",
    AccessDenied:
      "Sign-in was cancelled, or this Google account is not allowed yet. If the app is still in Testing in Google Cloud, add your email under Test users.",
    Verification: "The sign-in link expired or was already used. Please try again.",
    OAuthSignin: "Could not start Google sign-in. Try again in a moment.",
    OAuthCallback:
      "Google could not complete sign-in. Confirm the redirect URI in Google Cloud matches this app (see .env.example).",
    OAuthAccountNotLinked:
      "This email is already linked to another sign-in method. Use the original method or contact support.",
    MissingGoogleOAuth:
      "Google sign-in is not configured: add AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET to the server environment.",
    MissingDatabaseUrl:
      "Sign-in needs a database: add DATABASE_URL to .env.local (PostgreSQL). Run docker compose up -d and npx prisma migrate deploy, then restart npm run dev. See .env.example.",
    SessionRequired: "You need to sign in to continue.",
  };
  return messages[code] ?? "Something went wrong during sign-in. Please try again.";
}
