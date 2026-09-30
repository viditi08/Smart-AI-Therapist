import Link from "next/link";

export const metadata = { title: "Create an account | Emma" };

type Props = {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
};

export default async function RegisterPage({ searchParams }: Props) {
  const { error, redirectTo = "/session/voice" } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link className="auth-back" href="/login">
          ← Back to login
        </Link>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-lead">
          Tell Emma what to call you, choose a username, and add your email.
        </p>
        {error ? (
          <p className="auth-alert auth-alert-error" role="alert">
            {error}
          </p>
        ) : null}
        <form
          action="/api/account/register"
          method="post"
          className="basic-auth-form"
        >
          <label>
            Your name
            <input
              name="name"
              autoComplete="name"
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_.-]+"
              required
            />
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm password
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <fieldset className="auth-age-check">
            <legend>Are you 18 or older?</legend>
            <div className="auth-age-options">
              <label className="auth-age-option">
                <input type="radio" name="isAdult" value="yes" required />
                Yes
              </label>
              <label className="auth-age-option">
                <input type="radio" name="isAdult" value="no" required />
                No
              </label>
            </div>
          </fieldset>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button className="btn btn-primary btn-lg" type="submit">
            Create account
          </button>
        </form>
      </div>
    </div>
  );
}
