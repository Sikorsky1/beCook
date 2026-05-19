import type { TextareaHTMLAttributes } from "react";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ className = "", ...props }: TextAreaProps) {
  return (
    <textarea
      className={[
        "w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-white px-4 py-3.5 text-base leading-7 text-[color:var(--color-foreground)] outline-none transition-all duration-200 ease-out placeholder:text-[color:var(--color-muted-foreground)] placeholder:italic focus:border-transparent focus:bg-white focus:shadow-[inset_0_0_0_1px_rgba(232,213,181,0.9),0_0_0_4px_rgba(224,112,60,0.12)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-muted)] disabled:opacity-80 motion-reduce:transition-none",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
