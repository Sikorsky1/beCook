"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

// Motion Primitives: each navigation fades the new screen in. Opacity only: a transform or a
// filter here would turn the fixed bars inside the pages (proposal bar, save bar) into absolute ones.
export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="flex flex-1 flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
