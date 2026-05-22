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
        "rounded-[1.75rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[0_18px_45px_rgba(32,28,23,0.07)]",
        className,
      )}
      {...props}
    >
      {children}
    </article>
  );
}
