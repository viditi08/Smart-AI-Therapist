"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import {
  fadeUp,
  springBouncy,
  springPlayful,
  springSnappy,
} from "@/lib/motion-presets";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  mode?: "load" | "inView";
};

export function Reveal({
  children,
  className,
  delay = 0,
  mode = "inView",
}: RevealProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  const common = {
    className,
    custom: delay,
    variants: fadeUp,
    initial: "hidden" as const,
  };

  if (mode === "load") {
    return (
      <motion.div {...common} animate="visible">
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      {...common}
      whileInView="visible"
      viewport={{ once: true, amount: 0.2, margin: "-40px" }}
    >
      {children}
    </motion.div>
  );
}

type MotionCardProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function MotionCard({ children, className, delay = 0 }: MotionCardProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <li className={className}>{children}</li>;
  }

  return (
    <motion.li
      className={className}
      custom={delay}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      whileHover={{ y: -10, scale: 1.03, rotate: -0.4 }}
      whileTap={{ scale: 0.96, y: -2 }}
      transition={springSnappy}
    >
      {children}
    </motion.li>
  );
}

type HeroGlowProps = {
  className?: string;
};

export function HeroGlow({ className }: HeroGlowProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className} aria-hidden />;

  return (
    <motion.div
      className={className}
      aria-hidden
      animate={{
        opacity: [0.45, 0.9, 0.45],
        scale: [1, 1.12, 1],
      }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

type HeroOrbProps = {
  className?: string;
  delay?: number;
};

export function HeroOrb({ className, delay = 0 }: HeroOrbProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className} aria-hidden />;

  return (
    <motion.div
      className={className}
      aria-hidden
      animate={{
        x: [0, 18, -12, 0],
        y: [0, -14, 10, 0],
        scale: [1, 1.08, 0.96, 1],
      }}
      transition={{
        duration: 9,
        repeat: Infinity,
        ease: "easeInOut",
        delay,
      }}
    />
  );
}

type MotionButtonProps = {
  children: ReactNode;
  className?: string;
};

export function MotionButtonWrap({ children, className }: MotionButtonProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      whileHover={{ y: -5, scale: 1.04 }}
      whileTap={{ scale: 0.92, y: 1 }}
      transition={springBouncy}
    >
      {children}
    </motion.div>
  );
}

export function TypingIndicator() {
  const reduce = useReducedMotion();

  if (reduce) {
    return <span aria-label="Emma is typing">…</span>;
  }

  return (
    <span className="typing-dots" aria-label="Emma is typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ y: [0, -9, 0], scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 0.85,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.12,
          }}
        />
      ))}
    </span>
  );
}

/** Bouncy pill/tag — use on eyebrow labels. */
export function MotionPill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{children}</span>;

  return (
    <motion.span
      className={className}
      whileHover={{ scale: 1.08, y: -3 }}
      whileTap={{ scale: 0.95 }}
      transition={springPlayful}
    >
      {children}
    </motion.span>
  );
}
