"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AnimatedBackground } from "@/components/motion-primitives/animated-background";

// /shopping-list and /pantry redirect before rendering (step 32): only the current routes count.
const shoppingTabs = [
  { href: "/shopping/list", label: "Lista de la compra" },
  { href: "/shopping/pantry", label: "Despensa" },
];

export function ShoppingTabs() {
  const pathname = usePathname();
  const current = shoppingTabs.find((tab) => tab.href === pathname)?.href;

  return (
    <nav
      aria-label="Secciones de compra"
      className="grid grid-cols-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/80 p-1 shadow-[inset_0_1px_2px_rgba(42,33,28,0.05)]"
    >
      {/* Motion Primitives: the selected segment slides to the tab that is opened. */}
      <AnimatedBackground
        defaultValue={current}
        className="rounded-full bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]"
        transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
      >
        {shoppingTabs.map((tab) => {
          const isActive = pathname === tab.href;

          return (
            <Link
              key={tab.href}
              data-id={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-full px-3 text-center text-sm font-semibold transition-colors ${
                isActive
                  ? "text-[color:var(--color-accent-strong)]"
                  : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </AnimatedBackground>
    </nav>
  );
}
