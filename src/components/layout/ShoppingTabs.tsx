"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const shoppingTabs = [
  {
    href: "/shopping/list",
    label: "Lista de la compra",
    legacyHref: "/shopping-list",
  },
  {
    href: "/shopping/pantry",
    label: "Despensa",
    legacyHref: "/pantry",
  },
];

export function ShoppingTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones de compra"
      className="grid grid-cols-2 rounded-[1.35rem] border border-[color:var(--color-border)] bg-white/70 p-1 shadow-[var(--shadow-card)]"
    >
      {shoppingTabs.map((tab) => {
        const isActive = pathname === tab.href || pathname === tab.legacyHref;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-[1rem] px-3 text-center text-sm font-semibold transition-colors ${
              isActive
                ? "bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-hover)] shadow-[inset_0_0_0_1px_rgba(224,112,60,0.14)]"
                : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
