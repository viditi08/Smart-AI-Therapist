import Link from "next/link";
import { VoiceSession } from "@/components/voice-session";

export const metadata = {
  title: "Chat with Emma | Voice session",
  description:
    "Therapy-style conversation with Emma — voice and text with Gemini Live (not a licensed therapist).",
};

export default function SessionPage() {
  return (
    <div className="voice-chat-page">
      <Link className="voice-chat-page-back" href="/">
        ← Back to Emma
      </Link>
      <VoiceSession />
    </div>
  );
}
