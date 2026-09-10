import Link from "next/link";
import { getSession } from "@/lib/session";
import { GoogleGlyph } from "@/components/google-glyph";
import { TextPipelineSession } from "@/components/session/text-pipeline-session";

export const metadata = {
  title: "Emma · Text pipeline",
  description:
    "Same therapist cascade as voice — streaming LLM, crisis detection, rolling summaries, turn metrics.",
};

export default async function PipelineSessionPage() {
  const session = await getSession();

  return (
    <div className="voice-chat-page">
      <div className="voice-chat-page-toolbar">
        <Link className="voice-chat-page-back" href="/">
          ← Back
        </Link>
        <Link className="voice-chat-page-dashboard" href="/account">
          Dashboard
        </Link>
      </div>
      {!session?.user ? (
        <div className="session-auth-banner" role="region" aria-label="Sign in">
          <p className="session-auth-banner-text">
            Sign in to persist pipeline sessions to your account (optional in local dev).
          </p>
          <Link
            className="btn btn-google session-auth-banner-btn"
            href="/login?callbackUrl=/session/pipeline"
          >
            <GoogleGlyph />
            Continue with Google
          </Link>
        </div>
      ) : null}
      <TextPipelineSession />
    </div>
  );
}
