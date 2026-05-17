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
      "border-[#f1d6d6] bg-[#fef2f2] text-[#e11d48] hover:bg-[#fde8e8] hover:shadow-[0_12px_28px_rgba(225,29,72,0.10)]",
  },
  {
    href: "/import",
    label: "Importar menú",
    Icon: UploadCloud,
    className:
      "border-[#c9d8c7] bg-[#eef5ec] text-[#047857] hover:bg-[#e4efdf] hover:shadow-[0_12px_28px_rgba(4,120,87,0.10)]",
  },
  {
    href: "/shopping-list",
    label: "Lista de compra",
    Icon: ShoppingBasket,
    className:
      "border-[#c9d9e8] bg-[#eff6ff] text-[#2563eb] hover:bg-[#e2eef7] hover:shadow-[0_12px_28px_rgba(37,99,235,0.10)]",
  },
  {
    href: "/pantry",
    label: "Despensa",
    Icon: Archive,
    className:
      "border-[#e0d1b6] bg-[#fffbeb] text-[#b45309] hover:bg-[#f8efdc] hover:shadow-[0_12px_28px_rgba(180,83,9,0.10)]",
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
      aria-label={label}
      className={`flex aspect-square min-h-[76px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 text-center shadow-[0_8px_22px_rgba(32,28,23,0.035)] transition-all hover:-translate-y-0.5 ${className}`}
    >
      <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.9} />
      <span className="text-[0.68rem] font-semibold leading-tight">
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

  return (
    <header
      className={`z-40 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 py-3 backdrop-blur ${
        sticky ? "sticky top-0" : ""
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Link
          href="/"
          aria-label="Ir a Vista semanal"
          className="flex w-fit items-center gap-2.5"
        >
          <Image
            src="/favicon.ico"
            alt="beCook"
            width={28}
            height={28}
            className="h-7 w-7 rounded-lg"
          />
          <span className="text-sm font-semibold text-[color:var(--color-foreground)]">
            beCook
          </span>
        </Link>

        <nav
          className="grid w-full max-w-[22rem] grid-cols-3 gap-2.5 lg:max-w-[18rem]"
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
