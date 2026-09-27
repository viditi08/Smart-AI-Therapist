import Link from "next/link";
export const metadata = { title: "Create an account | Emma" };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; redirectTo?: string }> }) {
  const { error, redirectTo = "/session/voice" } = await searchParams;
  return <div className="auth-shell"><div className="auth-card">
    <Link className="auth-back" href="/login">← Back to login</Link><h1 className="auth-title">Create your account</h1>
    <p className="auth-lead">Choose a username and password to save Emma conversations to your account.</p>
    {error && <p className="auth-alert auth-alert-error" role="alert">{error}</p>}
    <form action="/api/account/register" method="post" className="basic-auth-form">
      <label>Username<input name="username" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button className="btn btn-primary btn-lg" type="submit">Create account</button>
    </form>
  </div></div>;
}
