import Link from "next/link";
import { Suspense } from "react";
import { AuthButtons } from "@/components/auth-buttons";
import { HomeHero } from "@/components/home-hero";
import {
  HomeCtaSection,
  HomeFeaturesSection,
  HomeWhySection,
} from "@/components/home-sections";

const painPoints = [
  { icon: "🕒", text: "Weeks–months of therapist waitlists" },
  { icon: "🧾", text: "High costs of sessions and subscriptions" },
  { icon: "🧍", text: "Difficulty opening up to strangers" },
  { icon: "🚨", text: "No one to talk to in emotional emergencies" },
];

const features = [
  {
    title: "24/7 Real-Time Support",
    description: "Talk to Emma anytime via voice or chat.",
  },
  {
    title: "Therapeutic Intelligence",
    description: "Built on CBT, mindfulness, and emotional grounding.",
  },
  {
    title: "Emotionally Aware Conversations",
    description: "Emma adapts to tone, intensity, and context.",
  },
  {
    title: "Privacy-First",
    description: "No tracking. No judgment. Full confidentiality.",
  },
  {
    title: "Voice or Text Interface",
    description: "Speak or type, depending on your comfort.",
  },
];

export default function HomePage() {
  return (
    <div className="page">
      <header className="header">
        <div className="header-inner">
          <Link className="logo" href="/">
            <span className="logo-mark" aria-hidden />
            Emma
          </Link>
          <nav className="nav" aria-label="Primary">
            <a href="#why">Why Emma</a>
            <a href="#features">Features</a>
            <Link href="/session">Voice</Link>
            <Link href="/session/pipeline">Text pipeline</Link>
            <a href="#cta">Get Started</a>
          </nav>
          <div className="header-actions">
            <Suspense fallback={<span className="auth-skeleton" aria-hidden />}>
              <AuthButtons />
            </Suspense>
            <a className="btn btn-ghost header-demo" href="#cta">
              Book a demo
            </a>
          </div>
        </div>
      </header>

      <main>
        <HomeHero />
        <HomeWhySection painPoints={painPoints} />
        <HomeFeaturesSection features={features} />
        <HomeCtaSection />
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <span className="logo-mark sm" aria-hidden />
            <span>Emma | AI Therapist</span>
          </div>
          <p className="footer-note">
            Emma is not a substitute for emergency services or professional
            diagnosis. If you are in crisis, please contact local emergency
            services or a licensed clinician.
          </p>
        </div>
      </footer>
    </div>
  );
}
