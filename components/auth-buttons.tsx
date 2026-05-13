import Link from "next/link";
import { auth } from "@/auth";
import { logout } from "./auth-actions";

export async function AuthButtons() {
  const session = await auth();

  if (!session?.user) {
    return (
      <Link href="/login" className="btn btn-ghost">
        Log in
      </Link>
    );
  }

  const label = session.user.name ?? session.user.email ?? "Account";

  return (
    <>
      <Link href="/account" className="user-chip" title={label}>
        {label}
      </Link>
      <form action={logout}>
        <button type="submit" className="btn btn-ghost">
          Sign out
        </button>
      </form>
    </>
  );
}
