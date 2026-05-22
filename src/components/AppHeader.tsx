"use client";

import {
  Archive,
  CalendarDays,
  ShoppingBasket,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AppHeaderProps = {
  sticky?: boolean;
};

type HeaderAction = {
  href: string;
  label: string;
  Icon: LucideIcon;
  className: string;
};

const headerActions: HeaderAction[] = [
  {
    href: "/",
    label: "Vista semanal",
    Icon: CalendarDays,
    className:
      "border-[#e8d5b5] bg-[#fff0e3] text-[#e0703c] hover:bg-[#fbe4d5] hover:shadow-[0_12px_28px_rgba(224,112,60,0.12)]",
  },
  {
    href: "/import",
    label: "Importar menú",
    Icon: UploadCloud,
    className:
      "border-[#cbd8b8] bg-[#f0f4e7] text-[#55633a] hover:bg-[#e7efd9] hover:shadow-[0_12px_28px_rgba(107,127,74,0.12)]",
  },
  {
    href: "/shopping-list",
    label: "Lista de compra",
    Icon: ShoppingBasket,
    className:
      "border-[#e9c997] bg-[#fff7e6] text-[#8a4e2a] hover:bg-[#f7ebcf] hover:shadow-[0_12px_28px_rgba(217,184,121,0.16)]",
  },
  {
    href: "/pantry",
    label: "Despensa",
    Icon: Archive,
    className:
      "border-[#e8d5b5] bg-[#f6f0e6] text-[#6b7f4a] hover:bg-[#efe5d1] hover:shadow-[0_12px_28px_rgba(107,127,74,0.12)]",
  },
];

function isCurrentRoute(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function HeaderActionCard({ href, label, Icon, className }: HeaderAction) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      className={`flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[1.15rem] border px-2.5 py-2 text-center shadow-[0_8px_22px_rgba(32,28,23,0.035)] transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 ${className}`}
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45),0_6px_14px_rgba(46,42,38,0.055)]">
        <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.95} />
      </span>
      <span className="text-[0.8rem] font-semibold leading-tight">
        {label}
      </span>
    </Link>
  );
}

export function AppHeader({ sticky = true }: AppHeaderProps) {
  const pathname = usePathname();
  const visibleActions = headerActions.filter(
    (action) => !isCurrentRoute(pathname, action.href),
  );
  const dividerClass = sticky
    ? "border-b border-[color:var(--color-border)]"
    : "";

  return (
    <header
      className={`z-40 ${dividerClass} bg-[color:var(--color-background)]/95 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur ${
        sticky ? "sticky top-0" : ""
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Link
          href="/"
          prefetch={false}
          aria-label="Ir a Vista semanal"
          className="flex min-h-12 w-fit touch-manipulation items-center gap-3 rounded-xl"
        >
          <Image
            src="/becook-header-logo.png"
            alt="beCook"
            width={38}
            height={38}
            unoptimized
            className="h-9 w-9 bg-transparent object-contain [clip-path:inset(1px_round_10px)]"
          />
          <span className="text-base font-semibold text-[color:var(--color-foreground)]">
            beCook
          </span>
        </Link>

        <nav
          className="mx-auto grid w-full max-w-[20rem] grid-cols-3 gap-2 lg:mx-0 lg:max-w-[17rem]"
          aria-label="Navegación principal"
        >
          {visibleActions.map((action) => (
            <HeaderActionCard key={action.href} {...action} />
          ))}
        </nav>
      </div>
    </header>
  );
}
