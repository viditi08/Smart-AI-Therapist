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
          <p className="session-auth-banner-text">Sign in to save chats to your account.</p>
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
