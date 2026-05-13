import Link from "next/link";
import { auth } from "@/auth";
import { GoogleGlyph } from "@/components/google-glyph";
import { VoiceSession } from "@/components/voice-session";

export const metadata = {
  title: "Chat with Emma | Voice session",
  description:
    "Therapy-style conversation with Emma — voice and text with Gemini Live (not a licensed therapist).",
};

export default async function SessionPage() {
  const session = await auth();

  return (
    <div className="voice-chat-page">
      <Link className="voice-chat-page-back" href="/">
        ← Back to Emma
      </Link>
      {!session?.user ? (
        <div className="session-auth-banner" role="region" aria-label="Sign in">
          <p className="session-auth-banner-text">
            <strong>Sign in with Google</strong> to save conversations to your account and
            open them from any device.
          </p>
          <Link
            className="btn btn-google session-auth-banner-btn"
            href="/login?callbackUrl=/session"
          >
            <GoogleGlyph />
            Continue with Google
          </Link>
        </div>
      ) : null}
      <VoiceSession />
    </div>
  );
}
