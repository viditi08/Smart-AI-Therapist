"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { MotionButtonWrap, MotionCard, MotionPill, Reveal } from "@/components/motion/reveal";
import { springBouncy } from "@/lib/motion-presets";

type PainPoint = { icon: string; text: string };
type Feature = { title: string; description: string };

export function HomeWhySection({ painPoints }: { painPoints: PainPoint[] }) {
  return (
    <section id="why" className="section why">
      <div className="container">
        <Reveal className="section-head">
          <MotionPill className="pill">Why Emma?</MotionPill>
          <h2>Support should not wait</h2>
          <p className="section-sub">
            Millions struggle with mental health support because of:
          </p>
        </Reveal>
        <ul className="pain-grid">
          {painPoints.map((item, i) => (
            <MotionCard
              key={item.text}
              className="pain-card"
              delay={i * 0.07}
            >
              <motion.span
                className="pain-icon"
                aria-hidden
                whileHover={{ scale: 1.28, rotate: -12, y: -4 }}
                whileTap={{ scale: 0.9, rotate: 6 }}
                transition={springBouncy}
              >
                {item.icon}
              </motion.span>
              <p>{item.text}</p>
            </MotionCard>
          ))}
        </ul>
        <Reveal className="solution-card" delay={0.1}>
          <p>
            <strong>Emma solves this</strong> by being available 24/7 for
            voice-to-voice support you can start in seconds — you speak, she
            listens and answers aloud — powered by advanced AI, built ethically,
            and designed for real emotional connection.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export function HomeFeaturesSection({ features }: { features: Feature[] }) {
  return (
    <section id="features" className="section features">
      <div className="container">
        <Reveal className="section-head">
          <MotionPill className="pill">Core features</MotionPill>
          <h2>How Emma can help you</h2>
          <p className="section-sub">
            Voice-led sessions with therapeutic depth — plus the option to type
            when that feels better for you.
          </p>
        </Reveal>
        <ul className="feature-grid">
          {features.map((f, i) => (
            <MotionCard
              key={f.title}
              className="feature-card"
              delay={i * 0.06}
            >
              <h3>{f.title}</h3>
              <p>{f.description}</p>
            </MotionCard>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HomeCtaSection() {
  const reduce = useReducedMotion();

  return (
    <section id="cta" className="section cta">
      <motion.div
        className="container cta-inner"
        initial={reduce ? false : { opacity: 0, y: 28, scale: 0.96 }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        whileHover={reduce ? undefined : { y: -8, scale: 1.02, rotate: -0.5 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        transition={springBouncy}
      >
        <h2>Start with your voice</h2>
        <p>
          Open a session, tap the mic, and talk it through — Emma meets you in
          real time, voice to voice.
        </p>
        <MotionButtonWrap>
          <Link className="btn btn-primary btn-lg" href="/session">
            Try a voice session free
          </Link>
        </MotionButtonWrap>
      </motion.div>
    </section>
  );
}
