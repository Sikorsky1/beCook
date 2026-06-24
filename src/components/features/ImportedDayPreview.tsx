import type { WeekDay } from "@/data/mockWeek";

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

export function ImportedDayPreview({ day }: { day: WeekDay }) {
  return (
    <article className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3.5 shadow-[0_18px_45px_rgba(32,28,23,0.07)] transition-[box-shadow,border-color,transform] duration-200 ease-out motion-reduce:transition-none sm:p-5">
      <div className="border-b border-[color:var(--color-border)] pb-2.5">
        <h2 className="text-2xl font-semibold leading-none text-[color:var(--color-foreground)] sm:text-3xl">
          {day.day}
        </h2>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {mealLabels.map((meal) => {
          const value = day[meal.key];
          const isFree = value === "LIBRE";

          return (
            <section
              key={meal.key}
              className="min-h-[126px] rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[color:var(--color-muted-foreground)]">
                  {meal.label}
                </h3>
                {isFree ? (
                  <span className="rounded-full bg-[color:var(--color-success-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--color-muted-foreground)]">
                    Libre
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 flex min-h-[64px] w-full items-start rounded-[var(--radius-input)] bg-[color:var(--color-surface-muted)] px-3 py-2.5 transition-colors duration-200 ease-out motion-reduce:transition-none">
                <p
                  className={
                    isFree
                      ? "text-base font-semibold text-[color:var(--color-muted-foreground)]"
                      : "text-base font-semibold leading-6 text-[color:var(--color-foreground)] sm:text-lg"
                  }
                >
                  {isFree ? "LIBRE" : value}
                </p>
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

