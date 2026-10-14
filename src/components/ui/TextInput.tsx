import type { InputHTMLAttributes } from "react";

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className = "", type = "text", ...props }: TextInputProps) {
  return (
    <input
      type={type}
      className={[
        "w-full min-h-11 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2.5 shadow-[inset_0_1px_2px_rgba(42,33,28,0.04)] text-base text-[color:var(--color-foreground)] transition-all duration-200 ease-out placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-surface)] focus:shadow-[0_0_0_4px_var(--glow)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-muted)] disabled:text-[color:var(--color-muted-foreground)] disabled:opacity-80 motion-reduce:transition-none",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
