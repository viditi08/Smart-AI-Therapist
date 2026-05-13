import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  return (
    <div className="dashboard-root">
      <DashboardSidebar user={session.user} />
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <p className="dashboard-topbar-label">Signed in</p>
          <Link href="/" className="dashboard-topbar-link">
            View public site →
          </Link>
        </header>
        <div className="dashboard-content">{children}</div>
      </div>
    </div>
  );
}
