"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// /shopping-list and /pantry redirect before rendering (step 32): only the current routes count.
const shoppingTabs = [
  { href: "/shopping/list", label: "Lista de la compra" },
  { href: "/shopping/pantry", label: "Despensa" },
];

export function ShoppingTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones de compra"
      className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-[color:var(--color-surface-muted)] p-1 shadow-inset"
    >
      {shoppingTabs.map((tab) => {
        const isActive = pathname === tab.href;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-[calc(var(--radius-control)-0.25rem)] px-3 text-center text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 ${
              isActive
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-raise"
                : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
