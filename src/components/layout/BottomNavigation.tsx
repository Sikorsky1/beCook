"use client";

import {
  CalendarDays,
  ChefHat,
  ShoppingBasket,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type BottomNavigationItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

const navigationItems: BottomNavigationItem[] = [
  {
    href: "/week",
    label: "Semana",
    Icon: CalendarDays,
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/week"),
  },
  {
    href: "/create-menu",
    label: "Crear menú",
    Icon: ChefHat,
    isActive: (pathname) =>
      pathname.startsWith("/create-menu") || pathname.startsWith("/import"),
  },
  {
    href: "/shopping/list",
    label: "Compra",
    Icon: ShoppingBasket,
    isActive: (pathname) =>
      pathname.startsWith("/shopping") ||
      pathname.startsWith("/shopping-list") ||
      pathname.startsWith("/pantry"),
  },
  {
    href: "/profile",
    label: "Perfil",
    Icon: UserRound,
    isActive: (pathname) =>
      pathname.startsWith("/profile") ||
      pathname.startsWith("/login") ||
      pathname.startsWith("/signup"),
  },
];

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="pointer-events-auto grid w-full max-w-[25rem] grid-cols-4 gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/92 p-1.5 shadow-[0_18px_48px_rgba(46,42,38,0.16)] backdrop-blur-xl">
        {navigationItems.map(({ href, label, Icon, isActive }) => {
          const active = isActive(pathname);

          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-full px-2 text-center text-[0.72rem] font-semibold leading-tight transition-[background-color,color,transform,box-shadow] duration-200 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${
                active
                  ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)] shadow-[inset_0_0_0_1px_rgba(232,213,181,0.55)]"
                  : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent-soft)] hover:text-[color:var(--color-foreground)]"
              }`}
            >
              <Icon
                aria-hidden="true"
                className="h-6 w-6"
                strokeWidth={active ? 2.25 : 2}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
