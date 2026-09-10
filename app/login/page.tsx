import Link from "next/link";
import { GoogleGlyph } from "@/components/google-glyph";
import { signInErrorMessage } from "@/lib/auth-sign-in-errors";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { isGoogleOAuthConfigured } from "@/lib/google-auth-env";
import { loginWithCredentials, loginWithGoogle } from "./actions";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string; created?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  let redirectTo = "/session/voice";
  if (
    typeof sp.callbackUrl === "string" &&
    sp.callbackUrl.startsWith("/") &&
    !sp.callbackUrl.startsWith("//")
  ) {
    redirectTo = sp.callbackUrl;
  }

  const oauthReady = isGoogleOAuthConfigured();
  const dbReady = isDatabaseUrlConfigured();
  const signInError = signInErrorMessage(
    typeof sp.error === "string" ? sp.error : undefined,
  );
  const basicError =
    sp.error === "InvalidCredentials"
      ? "Email or password is incorrect."
      : sp.error === "DatabaseRequired"
        ? "Email login needs PostgreSQL. Configure DATABASE_URL first."
        : null;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link className="auth-back" href="/">
          ← Back to Emma
        </Link>
        <h1 className="auth-title">Log in</h1>
        <p className="auth-lead">
          Log in so your voice sessions save to your account.
        </p>
        {basicError ? (
          <p className="auth-alert auth-alert-error" role="alert">
            {basicError}
          </p>
        ) : null}
        {sp.created ? (
          <p className="auth-alert auth-alert-warn" role="status">
            Account created. You can log in now.
          </p>
        ) : null}
        <form action={loginWithCredentials} className="basic-auth-form">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button type="submit" className="btn btn-primary btn-lg">
            Log in with email
          </button>
        </form>
        <p className="auth-register-link">
          New here?{" "}
          <Link href={`/register?redirectTo=${encodeURIComponent(redirectTo)}`}>
            Create an account
          </Link>
        </p>

        {signInError ? (
          <p className="auth-alert auth-alert-error" role="alert">
            {signInError}
          </p>
        ) : null}

        {!oauthReady && !signInError ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              Add <code className="env-code">AUTH_GOOGLE_ID</code> and{" "}
              <code className="env-code">AUTH_GOOGLE_SECRET</code> to{" "}
              <code className="env-code">.env.local</code> for Google sign-in.
            </p>
          </div>
        ) : null}

        {!dbReady && !signInError ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              <strong>DATABASE_URL</strong> is not set — saved sessions need Postgres.
            </p>
          </div>
        ) : null}

        <div className="auth-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <form action={loginWithGoogle}>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button
            type="submit"
            className="btn btn-google btn-lg"
            disabled={!oauthReady}
          >
            <GoogleGlyph />
            Continue with Google
          </button>
        </form>
        <p className="auth-foot">
          Emma is not emergency care. If you are in crisis, contact local emergency
          services or a licensed clinician.
        </p>
      </div>
    </div>
  );
}
