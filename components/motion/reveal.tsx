"use client";

import { motion, useReducedMotion } from "framer-motion";

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
