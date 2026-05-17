"use client";

import { useEffect, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import type { WeekDay } from "@/data/mockWeek";
import { pantryBaseItems } from "@/data/mockPantry";
import {
  cardClass,
  pageContentClass,
  pageHeroClass,
  pageHeroCopyClass,
  pageHeroInnerClass,
  pageShellClass,
  sectionBlockClass,
  sectionHeaderClass,
  statusPillClass,
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
  const selectedCount = pantryBaseItems.filter((item) =>
    pantryHasItem(selectedItems, item),
  ).length;

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
      <div className={pageContentClass}>
        <AppHeader />

        <section className={pageHeroClass}>
          <div className={pageHeroInnerClass}>
            <div className={pageHeroCopyClass}>
              <p className="ui-eyebrow">Despensa base</p>
              <h1 className="ui-title mt-5 text-5xl sm:text-6xl lg:text-7xl">
                Lo que ya tienes en casa.
              </h1>
              <p className="ui-copy mt-5 max-w-2xl text-lg sm:text-xl">
                Marca tus básicos habituales para que beCook no los añada a la
                lista de la compra de {weekLabel.toLowerCase()}.
              </p>
            </div>
          </div>
        </section>

        <section className={sectionBlockClass}>
          <div className={sectionHeaderClass}>
            <div>
              <p className="ui-eyebrow">Configuración</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-4xl">
                Selecciona tus básicos.
              </h2>
              <p className="ui-copy mt-3 max-w-2xl text-base sm:text-lg">
                Los ingredientes marcados se consideran disponibles y se
                ocultan automáticamente en la lista de la compra.
              </p>
            </div>

            {hasLoadedPantry ? (
              <div className={statusPillClass}>
                {selectedCount} de {pantryBaseItems.length} activos
              </div>
            ) : null}
          </div>

          <div className={`${cardClass} p-5 sm:p-6 lg:p-7`}>
            {!hasLoadedPantry ? (
              <article className="py-2">
                <p className="ui-eyebrow">Preparando</p>
                <h3 className="mt-3 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
                  Cargando tu despensa
                </h3>
                <p className="ui-copy mt-3 max-w-xl text-base">
                  Estamos recuperando los ingredientes que ya marcaste como
                  disponibles.
                </p>
              </article>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pantryBaseItems.map((item) => {
                  const isSelected = pantryHasItem(selectedItems, item);

                  return (
                    <label
                      key={item}
                      className={`flex min-h-20 cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-control)] border px-4 py-4 transition-colors ${
                        isSelected
                          ? "border-[color:var(--color-border-strong)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-surface-muted)]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item)}
                          className="h-6 w-6 shrink-0 rounded-md border-[color:var(--color-border-strong)] accent-[color:var(--color-accent)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-base font-semibold leading-6">
                            {item}
                          </span>
                          <span className="mt-0.5 block text-sm text-[color:var(--color-muted-foreground)]">
                            {isSelected ? "Se excluirá" : "Puede aparecer"}
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-border-strong)] px-5 py-5 text-sm leading-6 text-[color:var(--color-muted-foreground)] sm:px-7">
            <div className="max-w-2xl">
              <p className="font-semibold text-[color:var(--color-foreground)]">
                Esta selección se guarda automáticamente.
              </p>
              <p className="mt-1">
                La lista de la compra la usará para filtrar básicos como aceite,
                sal o pimienta sin que tengas que revisarlos cada semana.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
