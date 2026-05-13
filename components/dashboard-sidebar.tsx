"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/components/auth-actions";

type User = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type Props = { user: User };

export function DashboardSidebar({ user }: Props) {
  const pathname = usePathname();
  const label = user.name ?? user.email ?? "Account";

  const dashboardActive =
    pathname === "/account" || pathname.startsWith("/account/");

  return (
    <aside className="dashboard-sidebar" aria-label="Account navigation">
      <div className="dashboard-sidebar-brand">
        <Link href="/account" className="dashboard-sidebar-logo">
          <span className="dashboard-sidebar-mark" aria-hidden />
          <span>
            <span className="dashboard-sidebar-title">Emma</span>
            <span className="dashboard-sidebar-tagline">Your space</span>
          </span>
        </Link>
      </div>

      <nav className="dashboard-nav" aria-label="Dashboard">
        <Link
          href="/account"
          className={`dashboard-nav-link${dashboardActive ? " dashboard-nav-link-active" : ""}`}
        >
          Dashboard
        </Link>
        <Link
          href="/session"
          className="dashboard-nav-link"
        >
          Voice session
        </Link>
        <Link href="/" className="dashboard-nav-link dashboard-nav-link-muted">
          Marketing home
        </Link>
      </nav>

      <div className="dashboard-sidebar-user">
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={40}
            height={40}
            className="dashboard-sidebar-avatar"
            unoptimized
          />
        ) : (
          <div className="dashboard-sidebar-avatar dashboard-sidebar-avatar-fallback" aria-hidden>
            {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="dashboard-sidebar-user-text">
          <p className="dashboard-sidebar-user-name">{label}</p>
          {user.email ? (
            <p className="dashboard-sidebar-user-email">{user.email}</p>
          ) : null}
        </div>
      </div>

      <div className="dashboard-sidebar-footer">
        <form action={logout}>
          <button type="submit" className="btn btn-outline dashboard-sign-out-btn">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
