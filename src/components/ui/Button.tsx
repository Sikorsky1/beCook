import type { ComponentProps, ReactNode } from "react";

import { Button as ShadcnButton } from "@/components/shadcn/ui/button";

type ButtonVariant = "primary" | "secondary" | "soft" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = Omit<ComponentProps<typeof ShadcnButton>, "variant" | "size"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-12 px-6 text-sm",
};

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-[color:var(--color-accent-strong)] bg-[color:var(--color-accent-strong)] text-white hover:border-[color:var(--color-accent-strong-hover)] hover:bg-[color:var(--color-accent-strong-hover)] hover:shadow-[0_12px_28px_rgba(224,112,60,0.18)]",
  secondary:
    "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-secondary-hover)] hover:bg-[#e7efd9] hover:shadow-[0_12px_28px_rgba(107,127,74,0.12)]",
  soft:
    "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:shadow-[0_12px_28px_rgba(217,184,121,0.14)]",
  danger:
    "border-[#e8d5b5] bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)] hover:bg-[#fbe4d5]",
};

export function Button({
  children,
  className = "",
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <ShadcnButton
      type={type}
      className={[
        "inline-flex h-auto touch-manipulation items-center justify-center gap-2 whitespace-normal rounded-[var(--radius-control)] border text-center font-semibold shadow-[0_8px_22px_rgba(46,42,38,0.04)] transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-0.5 focus-visible:shadow-[0_0_0_4px_rgba(224,112,60,0.18),0_8px_22px_rgba(46,42,38,0.04)] active:translate-y-0 active:scale-[0.98] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:grayscale-[0.15] disabled:active:scale-100 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        buttonSizeClasses[size],
        buttonVariantClasses[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </ShadcnButton>
  );
}

export function PrimaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="primary" {...props} />;
}

export function SecondaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="secondary" {...props} />;
}

export function TertiaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="soft" {...props} />;
}

export function GhostButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="secondary" {...props} />;
}
