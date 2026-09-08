/** Shared Framer Motion springs + variants — playful bounce. */

export const easeCalm = [0.22, 1, 0.36, 1] as const;

/** Default bouncy spring — visible overshoot, still friendly. */
export const springPlayful = {
  type: "spring" as const,
  stiffness: 520,
  damping: 14,
  mass: 0.85,
};

/** Extra bounce for entrances + chat bubbles. */
export const springBouncy = {
  type: "spring" as const,
  stiffness: 640,
  damping: 11,
  mass: 0.75,
};

/** Snappy press / hover feedback. */
export const springSnappy = {
  type: "spring" as const,
  stiffness: 700,
  damping: 16,
  mass: 0.6,
};

/** Gentle float loops. */
export const springFloat = {
  type: "spring" as const,
  stiffness: 120,
  damping: 10,
  mass: 1.2,
};

export const fadeUp = {
  hidden: { opacity: 0, y: 32, scale: 0.94 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...springBouncy, delay },
  }),
};

export const fadeIn = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: (delay = 0) => ({
    opacity: 1,
    scale: 1,
    transition: { ...springPlayful, delay },
  }),
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
