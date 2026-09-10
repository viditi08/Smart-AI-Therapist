"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { GoogleGlyph } from "@/components/google-glyph";
import { MotionButtonWrap, Reveal } from "@/components/motion/reveal";
import { springBouncy } from "@/lib/motion-presets";

type LoginCardProps = {
  redirectTo: string;
  oauthReady: boolean;
  dbReady: boolean;
  signInError: string | null;
  showGoogleHint: boolean;
  showDbHint: boolean;
  loginAction: (formData: FormData) => Promise<void>;
};

export function LoginCard({
  redirectTo,
  oauthReady,
  dbReady,
  signInError,
  showGoogleHint,
  showDbHint,
  loginAction,
}: LoginCardProps) {
  const reduce = useReducedMotion();

  return (
    <div className="auth-shell">
      <motion.div
        className="auth-card auth-card-voice"
        initial={reduce ? false : { opacity: 0, y: 28, scale: 0.96 }}
        animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
        transition={springBouncy}
      >
        <Link className="auth-back" href="/">
          ← Back to Emma
        </Link>

        <Reveal mode="load" delay={0.05}>
          <span className="pill auth-pill">Voice-first</span>
        </Reveal>

        <Reveal mode="load" delay={0.1}>
          <h1 className="auth-title">Log in to talk with Emma</h1>
          <p className="auth-lead auth-lead-voice">
            Sign in once, then start a <strong>voice-to-voice</strong> session —
            speak naturally, Emma listens and responds aloud. Your saved
            conversations sync to your account.
          </p>
        </Reveal>

        {signInError ? (
          <p className="auth-alert auth-alert-error" role="alert">
            {signInError}
          </p>
        ) : null}

        {showGoogleHint ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              Add <code className="env-code">AUTH_GOOGLE_ID</code> and{" "}
              <code className="env-code">AUTH_GOOGLE_SECRET</code> to{" "}
              <code className="env-code">.env.local</code>, then restart{" "}
              <code className="env-code">npm run dev</code>.
            </p>
          </div>
        ) : null}

        {showDbHint ? (
          <div className="auth-alert auth-alert-warn" role="status">
            <p>
              <strong>DATABASE_URL</strong> not set — sign-in works, but saving
              chats needs Postgres. Run <code className="env-code">npm run db:migrate</code>.
            </p>
          </div>
        ) : null}

        <Reveal mode="load" delay={0.18}>
          <form action={loginAction}>
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <MotionButtonWrap className="auth-google-wrap">
              <button
                type="submit"
                className="btn btn-google btn-lg"
                disabled={!oauthReady}
              >
                <GoogleGlyph />
                Continue with Google
              </button>
            </MotionButtonWrap>
          </form>
        </Reveal>

        <Reveal mode="load" delay={0.24}>
          <div className="auth-voice-links">
            <Link className="btn btn-outline auth-voice-link" href="/session/voice">
              Try voice without saving
            </Link>
          </div>
        </Reveal>

        <p className="auth-foot">
          Emma is not emergency care. If you are in crisis, contact local
          emergency services or a licensed clinician.
        </p>
      </motion.div>
    </div>
  );
}
