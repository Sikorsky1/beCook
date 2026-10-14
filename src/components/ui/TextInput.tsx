import type { InputHTMLAttributes } from "react";

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className = "", type = "text", ...props }: TextInputProps) {
  return (
    <input
      type={type}
      className={[
        "w-full min-h-11 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3.5 py-2.5 text-base text-[color:var(--color-foreground)] shadow-inset transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:shadow-focus aria-[invalid=true]:border-[color:var(--color-danger)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-muted)] disabled:text-[color:var(--color-muted-foreground)] disabled:opacity-80 motion-reduce:transition-none",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
