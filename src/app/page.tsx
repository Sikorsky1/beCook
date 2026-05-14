"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DayCard } from "@/components/DayCard";
import { mockWeek, type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  pageContainerClass,
  pageShellClass,
} from "@/lib/ui";
import { readSavedWeek, saveWeek } from "@/lib/weekStorage";

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

function getWeekLabelFromDays(days: WeekDay[]) {
  if (days.length === 0) {
    return "Semana actual";
  }

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  return `Semana ${formatWeekBoundaryDate(firstDay.date)} - ${formatWeekBoundaryDate(lastDay.date)}`;
}

export default function Home() {
  const [weekDays, setWeekDays] = useState<WeekDay[]>(mockWeek.days);
  const [hasLoadedWeek, setHasLoadedWeek] = useState(false);
  const weekLabel = useMemo(() => getWeekLabelFromDays(weekDays), [weekDays]);

  useEffect(() => {
    // Cargamos la semana guardada solo después del primer render para evitar hydration mismatch.
    const loadWeek = window.setTimeout(() => {
      const savedWeek = readSavedWeek();

      if (savedWeek) {
        console.log("Cargando semana guardada:", savedWeek.length);
        setWeekDays(savedWeek);
      }

      setHasLoadedWeek(true);
    }, 0);

    return () => window.clearTimeout(loadWeek);
  }, []);

  useEffect(() => {
    if (!hasLoadedWeek) {
      return;
    }

    saveWeek(weekDays);
  }, [hasLoadedWeek, weekDays]);

  const handleMealChange = (
    dayName: string,
    mealKey: MealKey,
    value: string,
  ) => {
    setWeekDays((currentDays) =>
      currentDays.map((day) =>
        day.day === dayName
          ? {
              ...day,
              [mealKey]: value || "LIBRE",
            }
          : day,
      ),
    );
  };

  return (
    <main className={pageShellClass}>
      <div className={`${pageContainerClass} max-w-6xl gap-10 sm:gap-12`}>
        <section className="pt-5 sm:pt-8 lg:pt-12">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="ui-eyebrow">beCook</p>
              <h1 className="ui-title mt-5 text-5xl sm:text-6xl lg:text-7xl">
                {weekLabel || "Semana actual"}
              </h1>
              <p className="ui-copy mt-5 max-w-2xl text-lg sm:text-xl">
                Un plan claro para comer mejor esta semana, con espacio para
                cambiar de idea cuando lo necesites.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 lg:max-w-[22rem]">
              <Link href="/import" className={`${buttonPrimaryClass} min-h-14`}>
                Importar menú
              </Link>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Link
                  href="/shopping-list"
                  className={`${buttonSecondaryClass} bg-transparent`}
                >
                  Lista de la compra
                </Link>
                <Link
                  href="/pantry"
                  className={`${buttonSecondaryClass} bg-transparent`}
                >
                  Despensa base
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6 sm:space-y-8">
          <div className="flex flex-col gap-4 border-t border-[color:var(--color-border)] pt-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="ui-eyebrow">Plan semanal</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-4xl">
                Comidas y cenas, listas para revisar de un vistazo.
              </h2>
            </div>
            <div className="inline-flex w-fit items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium text-[color:var(--color-muted-foreground)] shadow-[var(--shadow-card)]">
              Toca cualquier plato para editarlo
            </div>
          </div>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            {weekDays.map((day) => (
              <DayCard
                key={day.day}
                day={day}
                onMealChange={handleMealChange}
                appearance="home"
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
