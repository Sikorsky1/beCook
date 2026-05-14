"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { WeekDay } from "@/data/mockWeek";
import { pantryBaseItems } from "@/data/mockPantry";
import {
  navButtonClass,
  pageContainerClass,
  pageShellClass,
  panelClass,
} from "@/lib/ui";
import {
  normalizePantryItemName,
  pantryHasItem,
  readPantryBase,
  savePantryBase,
} from "@/lib/pantryStorage";
import { readSavedWeek } from "@/lib/weekStorage";

const monthLabels: Record<string, string> = {
  ene: "enero",
  feb: "febrero",
  mar: "marzo",
  abr: "abril",
  may: "mayo",
  jun: "junio",
  jul: "julio",
  ago: "agosto",
  sep: "septiembre",
  oct: "octubre",
  nov: "noviembre",
  dic: "diciembre",
};

function formatWeekBoundaryDate(dateLabel: string) {
  const normalizedDate = dateLabel.trim().toLowerCase();
  const [day, month] = normalizedDate.split(/\s+/);

  if (!day || !month) {
    return dateLabel;
  }

  return `${day} ${monthLabels[month] ?? month}`;
}

function getWeekLabelFromDays(days: WeekDay[] | null) {
  if (!days || days.length === 0) {
    return "Semana actual";
  }

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  return `Semana ${formatWeekBoundaryDate(firstDay.date)} - ${formatWeekBoundaryDate(lastDay.date)}`;
}

export default function PantryPage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [hasLoadedPantry, setHasLoadedPantry] = useState(false);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const weekLabel = getWeekLabelFromDays(weekDays);

  useEffect(() => {
    // Leemos localStorage solo al montar para evitar diferencias con el HTML inicial.
    const loadPantry = window.setTimeout(() => {
      setSelectedItems(readPantryBase());
      setHasLoadedPantry(true);
    }, 0);

    return () => window.clearTimeout(loadPantry);
  }, []);

  useEffect(() => {
    const loadWeek = window.setTimeout(() => {
      setWeekDays(readSavedWeek());
    }, 0);

    return () => window.clearTimeout(loadWeek);
  }, []);

  useEffect(() => {
    if (!hasLoadedPantry) {
      return;
    }

    savePantryBase(selectedItems);
  }, [hasLoadedPantry, selectedItems]);

  const toggleItem = (itemName: string) => {
    const normalizedItemName = normalizePantryItemName(itemName);

    setSelectedItems((currentItems) =>
      currentItems.includes(normalizedItemName)
        ? currentItems.filter((item) => item !== normalizedItemName)
        : [...currentItems, normalizedItemName],
    );
  };

  return (
    <main className={pageShellClass}>
      <div className={pageContainerClass}>
        <section className={panelClass}>
          <div className="grid gap-0 lg:grid-cols-12">
            <div className="border-b border-[color:var(--color-border)] px-5 py-5 lg:col-span-7 lg:border-r lg:border-b-0 lg:px-7 lg:py-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="ui-eyebrow">beCook</div>
                <div className="hidden h-14 w-14 rounded-full border-8 border-[#2563eb] lg:block" />
              </div>

              <div className="max-w-3xl">
                <p className="ui-eyebrow">
                  Despensa
                </p>
                <h1 className="ui-title mt-3 text-4xl sm:text-5xl lg:text-6xl">
                  {weekLabel}
                </h1>
              </div>
            </div>

            <div className="grid grid-cols-12 lg:col-span-5">
              <div className="col-span-8 border-b border-l-0 border-[color:var(--color-border)] bg-[#facc15] px-5 py-4 lg:border-b-0 lg:border-l">
                <div className="ui-eyebrow text-stone-900">
                  Base
                </div>
              </div>
              <div className="col-span-4 border-b border-l border-[color:var(--color-border)] bg-[#dc2626] lg:border-b-0" />
              <div className="col-span-12 grid gap-0 sm:grid-cols-2">
                <Link href="/" className={`${navButtonClass} border-b border-[color:var(--color-border)] sm:border-r sm:border-b-0`}>
                  Volver a la semana
                </Link>
                <Link
                  href="/shopping-list"
                  className="flex min-h-14 items-center justify-center bg-[color:var(--color-accent)] px-4 text-center text-sm font-semibold tracking-[-0.02em] text-white transition-colors hover:bg-[color:var(--color-accent-hover)]"
                >
                  Lista de la compra
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className={panelClass}>
          <div className="grid gap-0 lg:grid-cols-12">
            <div className="border-b border-[color:var(--color-border)] px-5 py-5 lg:col-span-3 lg:border-r lg:border-b-0 lg:px-7">
              <h2 className="text-3xl font-semibold leading-none text-[color:var(--color-foreground)]">
                Despensa base
              </h2>
              <p className="ui-copy mt-4 max-w-xs text-sm">
                Marca lo que ya tienes en casa.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <div className="h-4 w-16 bg-stone-950" />
                <div className="h-4 w-4 rounded-full bg-[#2563eb]" />
                <div className="h-4 w-8 bg-[#facc15]" />
              </div>
            </div>

            <div className="lg:col-span-9">
              <div className="grid gap-0 lg:grid-cols-2">
                {!hasLoadedPantry ? (
                  <article className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 lg:col-span-2 lg:border-b-0">
                    <h3 className="text-xl font-semibold text-[color:var(--color-foreground)]">
                      Cargando tu despensa
                    </h3>
                    <p className="ui-copy mt-3 max-w-md text-sm">
                      Estamos recuperando los ingredientes que ya marcaste como disponibles.
                    </p>
                  </article>
                ) : (
                  pantryBaseItems.map((item) => {
                    const isSelected = pantryHasItem(selectedItems, item);

                    return (
                      <article
                        key={item}
                        className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 sm:p-6 lg:last:border-b-0 [&:nth-child(2n)]:lg:border-l"
                      >
                        <label
                          className={`flex cursor-pointer items-center justify-between gap-4 rounded-[calc(var(--radius-card)-0.375rem)] border px-4 py-4 transition-colors ${
                            isSelected
                              ? "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
                              : "border-[color:var(--color-border)] bg-white text-[color:var(--color-foreground)]"
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleItem(item)}
                              className="h-5 w-5 rounded-none border-stone-900 accent-stone-900"
                            />
                            <span className="text-sm font-medium sm:text-[15px]">
                              {item}
                            </span>
                          </span>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                              isSelected
                                ? "border-transparent bg-[#facc15] text-[color:var(--color-foreground)]"
                                : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)]"
                            }`}
                          >
                            {isSelected ? "Disponible" : "Opcional"}
                          </span>
                        </label>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
