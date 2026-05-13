import Link from "next/link";
import { Suspense } from "react";
import { AuthButtons } from "@/components/auth-buttons";

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
            <a href="#cta">Get Started</a>
          </nav>
          <div className="header-actions">
            <Suspense fallback={<span className="auth-skeleton" aria-hidden />}>
              <AuthButtons />
            </Suspense>
            <a className="btn btn-ghost header-demo" href="#cta">
              Book a demo
            </a>
            <Link className="btn btn-primary" href="/session">
              Start voice session
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-glow" aria-hidden />
          <div className="container hero-inner">
            <p className="eyebrow">Voice-first · conversational AI companion</p>
            <h1 className="hero-title">
              Meet Emma — your{" "}
              <span className="hero-title-accent">conversational</span> AI
              therapist
            </h1>
            <p className="hero-lead">
              A real back-and-forth: you talk or type, Emma listens and responds
              in a natural voice — reflective, human-like support whenever you need
              a safe space. Voice comes first; chat is always there too.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" href="/session">
                Start a voice session
              </Link>
              <a className="btn btn-outline btn-lg" href="#why">
                Learn more
              </a>
            </div>
            <dl className="stats">
              <div className="stat">
                <dt className="sr-only">Availability</dt>
                <dd>
                  <strong>24/7</strong>
                  <span>Always here</span>
                </dd>
              </div>
              <div className="stat">
                <dt className="sr-only">Modality</dt>
                <dd>
                  <strong>Voice to voice</strong>
                  <span>Natural speech · chat optional</span>
                </dd>
              </div>
              <div className="stat">
                <dt className="sr-only">Approach</dt>
                <dd>
                  <strong>Ethical AI</strong>
                  <span>Built for trust</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section id="why" className="section why">
          <div className="container">
            <div className="section-head">
              <span className="pill">Why Emma?</span>
              <h2>Support should not wait</h2>
              <p className="section-sub">
                Millions struggle with mental health support because of:
              </p>
            </div>
            <ul className="pain-grid">
              {painPoints.map((item) => (
                <li key={item.text} className="pain-card">
                  <span className="pain-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
            <div className="solution-card">
              <p>
                <strong>Emma solves this</strong> by being available 24/7 for
                voice-to-voice support you can start in seconds — you speak,
                she listens and answers aloud — powered by advanced AI, built
                ethically, and designed for real emotional connection.
              </p>
            </div>
          </div>
        </section>

        <section id="features" className="section features">
          <div className="container">
            <div className="section-head">
              <span className="pill">Core features</span>
              <h2>How Emma can help you</h2>
              <p className="section-sub">
                Voice-led sessions with therapeutic depth — plus the option to
                type when that feels better for you.
              </p>
            </div>
            <ul className="feature-grid">
              {features.map((f) => (
                <li key={f.title} className="feature-card">
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="cta" className="section cta">
          <div className="container cta-inner">
            <h2>Start with your voice</h2>
            <p>
              Open a session, tap the mic, and talk it through — Emma meets you
              in real time, voice to voice.
            </p>
            <Link className="btn btn-primary btn-lg" href="/session">
              Try a voice session free
            </Link>
          </div>
        </section>
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
