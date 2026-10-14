"use client";

import {
  CalendarDays,
  ShoppingBasket,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AnimatedBackground } from "@/components/motion-primitives/animated-background";
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
      <div className="pointer-events-auto grid w-full max-w-[22.5rem] grid-cols-3 gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/85 p-1.5 shadow-[var(--shadow-float)] backdrop-blur-xl">
        {/* Motion Primitives: the active pill slides between destinations (layout animation). */}
        <AnimatedBackground
          defaultValue={current ?? undefined}
          className="rounded-full bg-[color:var(--color-ink)] shadow-[0_10px_24px_-10px_rgba(42,33,28,0.6)]"
          transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
        >
          {appSections.map((section) => {
            const active = current === section.id;
            const Icon = sectionIcons[section.id];

            return (
              <Link
                key={section.id}
                data-id={section.id}
                href={section.href}
                prefetch={false}
                aria-current={sectionAriaCurrent(section, pathname)}
                className={`flex min-h-[4.25rem] flex-col items-center justify-center rounded-full px-2 text-center text-[0.8125rem] font-semibold leading-tight transition-colors duration-200 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${
                  active
                    ? "text-[color:var(--color-ink-foreground)]"
                    : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                }`}
              >
                <span className="flex flex-col items-center gap-1">
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6"
                    strokeWidth={active ? 2.25 : 2}
                  />
                  <span>{section.label}</span>
                </span>
              </Link>
            );
          })}
        </AnimatedBackground>
      </div>
    </nav>
  );
}
