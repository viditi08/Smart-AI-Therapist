import Link from "next/link";
import { PipecatSession } from "@/components/session/pipecat-session";
import { getSession } from "@/lib/session";

export const metadata = {
  title: "Talk with Emma",
  description: "A live voice session with Emma.",
};

export default async function VoiceSessionPage() {
  const session = await getSession();
  const signedIn = Boolean(session?.user);

  return (
    <div className="talk-room">
      <header className="talk-room-bar">
        <Link className="talk-room-brand" href="/">
          <span className="talk-room-mark" aria-hidden />
          Emma
        </Link>
        <div className="talk-room-bar-end">
          <span className={`talk-room-pill${signedIn ? " is-saved" : ""}`}>
            {signedIn ? "Saving to your account" : "Guest · not saved"}
          </span>
          {signedIn ? (
            <Link className="talk-room-link" href="/account">
              Sessions
            </Link>
          ) : (
            <Link className="talk-room-link" href="/login?callbackUrl=/session/voice">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <PipecatSession />
    </div>
  );
}
