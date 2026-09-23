import Link from "next/link";
import { isDatabaseUrlConfigured } from "@/lib/database-env";
import { loginWithCredentials } from "./actions";

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

  const dbReady = isDatabaseUrlConfigured();
  const basicError =
    sp.error === "InvalidCredentials"
      ? "Username or password is incorrect."
      : sp.error === "DatabaseRequired"
        ? "Login needs PostgreSQL. Configure DATABASE_URL first."
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
            Username
            <input name="username" autoComplete="username" required />
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
            Log in
          </button>
        </form>
        <p className="auth-register-link">
          New here?{" "}
          <Link href={`/register?redirectTo=${encodeURIComponent(redirectTo)}`}>
            Create an account
          </Link>
        </p>

        {!dbReady ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              <strong>DATABASE_URL</strong> is not set — saved sessions need Postgres.
            </p>
          </div>
        ) : null}

        <p className="auth-foot">
          Emma is not emergency care. If you are in crisis, contact local emergency
          services or a licensed clinician.
        </p>
      </div>
    </div>
  );
}
