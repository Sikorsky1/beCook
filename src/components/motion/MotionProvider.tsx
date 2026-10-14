"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

// Motion Primitives: every animation follows the system setting. With «reducir movimiento»
// transforms and layout animations are skipped and only opacity changes remain.
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
