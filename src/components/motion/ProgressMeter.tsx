"use client";

import { motion } from "motion/react";

import { AnimatedNumber } from "@/components/motion-primitives/animated-number";
import { cn } from "@/lib/utils";

// Motion Primitives: a thin bar that grows to the share done. Decorative: the count next to it
// carries the meaning.
export function ProgressMeter({ done, total, className }: { done: number; total: number; className?: string }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const complete = total > 0 && done === total;

  return (
    <div aria-hidden="true" className={cn("h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]", className)}>
      <motion.div
        className={`h-full origin-left rounded-full ${
          complete
            ? "bg-[color:var(--color-success)]"
            : "bg-gradient-to-r from-[color:var(--color-accent)] to-[color:var(--color-accent-strong)]"
        }`}
        initial={false}
        animate={{ scaleX: ratio }}
        transition={{ type: "spring", stiffness: 160, damping: 26 }}
      />
    </div>
  );
}

// The number rolls to its new value. Decorative: pair it with the figure in text (sr-only).
export function CountUp({ value, className }: { value: number; className?: string }) {
  return (
    <AnimatedNumber value={value} className={className} springOptions={{ bounce: 0, duration: 700 }} />
  );
}
