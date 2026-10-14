import type { TextareaHTMLAttributes } from "react";

import { Textarea as ShadcnTextarea } from "@/components/shadcn/ui/textarea";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ className = "", ...props }: TextAreaProps) {
  return (
    <ShadcnTextarea
      className={[
        "w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-base leading-7 text-[color:var(--color-foreground)] shadow-inset transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:shadow-focus aria-[invalid=true]:border-[color:var(--color-danger)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-muted)] disabled:opacity-80 motion-reduce:transition-none md:text-base",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
