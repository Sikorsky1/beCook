"use client";

import {
  CalendarDays,
  ShoppingBasket,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeSection, appSections, sectionAriaCurrent, type AppSectionId } from "@/lib/navigation";

// Step 32: three destinations (design-plans/2026-10-12-navegacion-paso-32.md). «Crear menú» is
// reached from Semana and marks it active; which route marks which section lives in navigation.ts.
const sectionIcons: Record<AppSectionId, LucideIcon> = {
  week: CalendarDays,
  shopping: ShoppingBasket,
  profile: UserRound,
};

export function BottomNavigation() {
  const pathname = usePathname();
  const current = activeSection(pathname);

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.85rem+env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="pointer-events-auto grid w-full max-w-[22.5rem] grid-cols-3 gap-1 rounded-[1.375rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 p-1.5 shadow-pop backdrop-blur-xl">
        {appSections.map((section) => {
          const active = current === section.id;
          const Icon = sectionIcons[section.id];

          return (
            <Link
              key={section.id}
              href={section.href}
              prefetch={false}
              aria-current={sectionAriaCurrent(section, pathname)}
              className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center text-[0.8125rem] font-semibold leading-tight transition-[background-color,color,transform,box-shadow] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${
                active
                  ? "bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-strong-hover)]"
                  : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
              }`}
            >
              <Icon
                aria-hidden="true"
                className="h-6 w-6"
                strokeWidth={active ? 2.25 : 2}
              />
              <span>{section.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
