import type { TextareaHTMLAttributes } from "react";

import { Textarea as ShadcnTextarea } from "@/components/shadcn/ui/textarea";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ className = "", ...props }: TextAreaProps) {
  return (
    <ShadcnTextarea
      className={[
        "w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3.5 text-base leading-7 text-[color:var(--color-foreground)] transition-all duration-200 ease-out placeholder:text-[color:var(--color-muted-foreground)] placeholder:italic focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-surface)] focus:shadow-[inset_0_0_0_1px_rgba(232,213,181,0.9),0_0_0_4px_var(--glow)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-muted)] disabled:opacity-80 motion-reduce:transition-none md:text-base",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
