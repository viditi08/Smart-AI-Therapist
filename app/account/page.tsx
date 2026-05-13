import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { logout } from "@/components/auth-actions";
import { SavedSessionsDashboard } from "@/components/saved-sessions-dashboard";

export default async function AccountPage() {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  const { user } = session;

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide">
        <Link className="auth-back" href="/">
          ← Back to Emma
        </Link>
        <h1 className="auth-title">Your account</h1>
        <p className="auth-lead">Signed in with Google.</p>

        <div className="account-profile">
          {user.image ? (
            <Image
              src={user.image}
              alt=""
              width={72}
              height={72}
              className="account-avatar"
              unoptimized
            />
          ) : (
            <div className="account-avatar account-avatar-fallback" aria-hidden>
              {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="account-meta">
            {user.name && <p className="account-name">{user.name}</p>}
            {user.email && (
              <p className="account-email text-muted">{user.email}</p>
            )}
          </div>
        </div>

        <SavedSessionsDashboard />

        <div className="account-actions">
          <form action={logout}>
            <button type="submit" className="btn btn-outline btn-lg">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
