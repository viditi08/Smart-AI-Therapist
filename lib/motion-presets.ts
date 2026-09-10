/** Shared Framer Motion springs + variants. */

export const easeCalm = [0.22, 1, 0.36, 1] as const;

export const springPlayful = {
  type: "spring" as const,
  stiffness: 520,
  damping: 14,
  mass: 0.85,
};

export const springBouncy = {
  type: "spring" as const,
  stiffness: 640,
  damping: 11,
  mass: 0.75,
};

export const bubbleIn = {
  hidden: { opacity: 0, y: 22, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springBouncy,
  },
  exit: {
    opacity: 0,
    y: -12,
    scale: 0.94,
    transition: { duration: 0.18, ease: easeCalm },
  },
};

export const metricsPulse = {
  idle: { backgroundColor: "rgba(232, 242, 250, 1)", scale: 1 },
  flash: {
    backgroundColor: "rgba(74, 143, 212, 0.16)",
    scale: [1, 1.02, 1],
    transition: springPlayful,
  },
};

export const metricValuePop = {
  hidden: { scale: 0.75, opacity: 0.4 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: springBouncy,
  },
};
