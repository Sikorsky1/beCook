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

// Marigold: the primary is a raised orange material (gradient + inner highlight); the rest stay flat
// with a hairline border. No hover lift: depth comes from the shadow alone.
const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[color:var(--color-accent-strong)] bg-[image:var(--accent-gradient)] text-[color:var(--color-primary-foreground)] shadow-primary hover:bg-[image:var(--accent-gradient-hover)] hover:shadow-primary-hover focus-visible:shadow-[var(--mg-shadow-focus),var(--mg-shadow-primary)]",
  secondary:
    "border-transparent bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-border)] focus-visible:shadow-focus",
  soft:
    "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-xs hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-background)] focus-visible:shadow-focus",
  danger:
    "border-[color:var(--color-danger-soft)] bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)] hover:border-[color:var(--color-danger)] focus-visible:shadow-focus",
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
        "inline-flex h-auto touch-manipulation items-center justify-center gap-2 whitespace-normal rounded-[var(--radius-control)] border text-center font-semibold transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
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
