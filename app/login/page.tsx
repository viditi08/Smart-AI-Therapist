import Link from "next/link";
import { GoogleGlyph } from "@/components/google-glyph";
import { signInErrorMessage } from "@/lib/auth-sign-in-errors";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { isGoogleOAuthConfigured } from "@/lib/google-auth-env";
import { loginWithGoogle } from "./actions";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  let redirectTo = "/account";
  if (
    typeof sp.callbackUrl === "string" &&
    sp.callbackUrl.startsWith("/") &&
    !sp.callbackUrl.startsWith("//")
  ) {
    redirectTo = sp.callbackUrl;
  }

  const oauthReady = isGoogleOAuthConfigured();
  const dbReady = isDatabaseUrlConfigured();
  const canSignIn = oauthReady;
  const signInError = signInErrorMessage(
    typeof sp.error === "string" ? sp.error : undefined,
  );
  const showGoogleHint = !oauthReady && !signInError;
  const showDbHint = !dbReady && !signInError;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link className="auth-back" href="/">
          ← Back to Emma
        </Link>
        <h1 className="auth-title">Log in</h1>
        <p className="auth-lead">
          Use your <strong>Google account</strong> — same flow as “Sign in with Google” on
          other apps. After you continue, you will be signed in here and can save chats to
          your account.
        </p>

        {signInError ? (
          <p className="auth-alert auth-alert-error" role="alert">
            {signInError}
          </p>
        ) : null}

        {showGoogleHint ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              Google sign-in is not configured on this server yet. Add{" "}
              <code className="env-code">AUTH_GOOGLE_ID</code> and{" "}
              <code className="env-code">AUTH_GOOGLE_SECRET</code> from{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Cloud Console
              </a>{" "}
              (OAuth client ID, type Web application) plus{" "}
              <code className="env-code">AUTH_SECRET</code> in{" "}
              <code className="env-code">.env.local</code> (not only in{" "}
              <code className="env-code">.env.example</code>). See{" "}
              <code className="env-code">.env.example</code> for the full list.
            </p>
            <p className="auth-alert-sub">
              Until then, <strong>Continue with Google</strong> stays disabled — you will not
              see Google&apos;s sign-in page. After saving <code className="env-code">.env.local</code>,{" "}
              <strong>restart the dev server</strong> (stop <code className="env-code">npm run dev</code> and
              start it again) so Next.js picks up the new variables.
            </p>
          </div>
        ) : null}

        {showDbHint ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              <strong>DATABASE_URL</strong> is not set. You can still sign in with Google;
              your session will work, but <strong>saving chats to your account</strong> needs
              PostgreSQL. Add <code className="env-code">DATABASE_URL</code> to{" "}
              <code className="env-code">.env.local</code> (see{" "}
              <code className="env-code">.env.example</code>), run{" "}
              <code className="env-code">docker compose up -d</code> and{" "}
              <code className="env-code">npx prisma migrate deploy</code>, then restart{" "}
              <code className="env-code">npm run dev</code>.
            </p>
          </div>
        ) : null}

        <form action={loginWithGoogle}>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button
            type="submit"
            className="btn btn-google btn-lg"
            disabled={!canSignIn}
            aria-disabled={!canSignIn}
          >
            <GoogleGlyph />
            Continue with Google
          </button>
        </form>
        <p className="auth-foot">
          By continuing you agree to our approach to privacy and consent around
          AI-assisted support.
        </p>
      </div>
    </div>
  );
}
