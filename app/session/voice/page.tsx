import Link from "next/link";
import { VoicePipelineSession } from "@/components/voice-pipeline-session";
import { getSession } from "@/lib/session";

export const metadata = {
  title: "Emma · Voice session",
  description: "Talk with Emma — speak, and she answers out loud.",
};

export default async function VoiceSessionPage() {
  const session = await getSession();

  return (
    <div className="voice-chat-page">
      <div className="voice-chat-page-toolbar">
        <Link className="voice-chat-page-back" href="/">
          ← Back
        </Link>
        {session?.user ? (
          <Link className="voice-chat-page-dashboard" href="/account">
            Your sessions
          </Link>
        ) : (
          <Link className="voice-chat-page-dashboard" href="/login?callbackUrl=/session/voice">
            Log in to save
          </Link>
        )}
      </div>
      <p className="voice-stage-save-hint">
        {session?.user
          ? `Signed in as ${session.user.email ?? session.user.name}. This conversation saves to your account.`
          : "Log in to save this conversation to your account."}
      </p>
      <VoicePipelineSession />
    </div>
  );
}
