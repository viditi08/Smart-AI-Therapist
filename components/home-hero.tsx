"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { HeroGlow, HeroOrb, MotionButtonWrap, Reveal } from "@/components/motion/reveal";
import { springBouncy, springPlayful } from "@/lib/motion-presets";

export function HomeHero() {
  const reduce = useReducedMotion();

  return (
    <section className="hero">
      <HeroGlow className="hero-glow" />
      <HeroOrb className="hero-orb hero-orb-1" />
      <HeroOrb className="hero-orb hero-orb-2" delay={2} />
      <div className="container hero-inner">
        <Reveal mode="load" delay={0.05}>
          <p className="eyebrow">Voice-first · conversational AI companion</p>
        </Reveal>
        <Reveal mode="load" delay={0.12}>
          <h1 className="hero-title">
            Meet Emma — your{" "}
            <motion.span
              className="hero-title-accent"
              animate={
                reduce
                  ? undefined
                  : {
                      backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                      y: [0, -3, 0],
                    }
              }
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            >
              conversational
            </motion.span>{" "}
            AI therapist
          </h1>
        </Reveal>
        <Reveal mode="load" delay={0.2}>
          <p className="hero-lead">
            A real back-and-forth: you talk or type, Emma listens and responds
            in a natural voice — reflective, human-like support whenever you need
            a safe space. Voice comes first; chat is always there too.
          </p>
        </Reveal>
        <Reveal mode="load" delay={0.28}>
          <div className="hero-cta">
            <MotionButtonWrap>
              <Link className="btn btn-primary btn-lg" href="/session/voice">
                Start voice-to-voice
              </Link>
            </MotionButtonWrap>
            <MotionButtonWrap>
              <a className="btn btn-outline btn-lg" href="#why">
                Learn more
              </a>
            </MotionButtonWrap>
          </div>
        </Reveal>
        <Reveal mode="load" delay={0.36}>
          <dl className="stats">
            {[
              { strong: "24/7", span: "Always here", label: "Availability" },
              {
                strong: "Voice to voice",
                span: "Natural speech · chat optional",
                label: "Modality",
              },
              {
                strong: "Ethical AI",
                span: "Built for trust",
                label: "Approach",
              },
            ].map((s) => (
              <motion.div
                key={s.label}
                className="stat"
                whileHover={
                  reduce
                    ? undefined
                    : { y: -8, scale: 1.05, rotate: -1.5 }
                }
                whileTap={reduce ? undefined : { scale: 0.97 }}
                transition={springBouncy}
              >
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <strong>{s.strong}</strong>
                  <span>{s.span}</span>
                </dd>
              </motion.div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
