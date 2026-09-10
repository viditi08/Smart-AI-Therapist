import Image from "next/image";
import { getSession } from "@/lib/session";
import { SavedSessionsDashboard } from "@/components/saved-sessions-dashboard";

export default async function AccountPage() {
  const session = await getSession();
  if (!session?.user) {
    return null;
  }
  const { user } = session;

  return (
    <>
      <header className="dashboard-page-header">
        <p className="dashboard-page-eyebrow">Overview</p>
        <h1 className="dashboard-page-title">Dashboard</h1>
        <p className="dashboard-page-lead text-muted">
          Saved conversations and profile — a calmer layout than the public marketing site.
        </p>
      </header>

      <section className="dashboard-card dashboard-card-profile" aria-labelledby="dash-profile-heading">
        <h2 id="dash-profile-heading" className="dashboard-card-title">
          Profile
        </h2>
        <div className="dashboard-profile-row">
          {user.image ? (
            <Image
              src={user.image}
              alt=""
              width={80}
              height={80}
              className="dashboard-profile-avatar"
              unoptimized
            />
          ) : (
            <div className="dashboard-profile-avatar dashboard-profile-avatar-fallback" aria-hidden>
              {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="dashboard-profile-meta">
            {user.name ? <p className="dashboard-profile-name">{user.name}</p> : null}
            {user.email ? (
              <p className="dashboard-profile-email text-muted">{user.email}</p>
            ) : null}
            <p className="dashboard-profile-provider text-muted">Signed in with Google</p>
          </div>
        </div>
      </section>

      <SavedSessionsDashboard />
    </>
  );
}
