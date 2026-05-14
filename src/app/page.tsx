"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DayCard } from "@/components/DayCard";
import { mockWeek, type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  buttonGhostClass,
  buttonPrimaryClass,
  pageActionsClass,
  pageContentClass,
  pageHeroClass,
  pageHeroCopyClass,
  pageHeroInnerClass,
  pageShellClass,
  sectionBlockClass,
  sectionHeaderClass,
  statusPillClass,
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
      <div className={pageContentClass}>
        <section className={pageHeroClass}>
          <div className={pageHeroInnerClass}>
            <div className={pageHeroCopyClass}>
              <p className="ui-eyebrow">beCook</p>
              <h1 className="ui-title mt-5 text-5xl sm:text-6xl lg:text-7xl">
                {weekLabel || "Semana actual"}
              </h1>
              <p className="ui-copy mt-5 max-w-2xl text-lg sm:text-xl">
                Un plan claro para comer mejor esta semana, con espacio para
                cambiar de idea cuando lo necesites.
              </p>
            </div>

            <div className={pageActionsClass}>
              <Link href="/import" className={`${buttonPrimaryClass} min-h-14`}>
                Importar menú
              </Link>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Link href="/shopping-list" className={buttonGhostClass}>
                  Lista de la compra
                </Link>
                <Link href="/pantry" className={buttonGhostClass}>
                  Despensa base
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className={sectionBlockClass}>
          <div className={sectionHeaderClass}>
            <div>
              <p className="ui-eyebrow">Plan semanal</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-4xl">
                Comidas y cenas, listas para revisar de un vistazo.
              </h2>
            </div>
            <div className={statusPillClass}>
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
