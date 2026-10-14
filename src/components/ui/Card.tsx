import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <article
      data-slot="card"
      className={cn(
        "rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-card",
        className,
      )}
      {...props}
    >
      {children}
    </article>
  );
}
