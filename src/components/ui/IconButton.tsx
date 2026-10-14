import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function IconButton({
  children,
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)] shadow-[var(--shadow-card)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)] transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[color:var(--color-surface-muted)] focus-visible:text-[color:var(--color-foreground)] active:translate-y-0 active:scale-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-[color:var(--color-border)] disabled:bg-white/60 disabled:text-[color:var(--color-border-strong)] disabled:opacity-70 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
