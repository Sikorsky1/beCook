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
        "inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-xs transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-background)] focus-visible:shadow-focus active:scale-95 disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-muted)] disabled:text-[color:var(--color-muted-foreground)] disabled:shadow-none disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
