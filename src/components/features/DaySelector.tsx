export const orderedDays = [
  { name: "Lunes", shortName: "L" },
  { name: "Martes", shortName: "M" },
  { name: "Miércoles", shortName: "X" },
  { name: "Jueves", shortName: "J" },
  { name: "Viernes", shortName: "V" },
  { name: "Sábado", shortName: "S" },
  { name: "Domingo", shortName: "D" },
] as const;

export type DayName = (typeof orderedDays)[number]["name"];

type DaySelectorProps = {
  ariaLabel: string;
  availableDays: Set<string>;
  selectedDayName: DayName;
  onSelectDay: (dayName: DayName) => void;
};

export function getInitialSelectedDayName(days: { day: string }[]): DayName {
  const monday = orderedDays[0];
  const firstAvailableDay =
    orderedDays.find((orderedDay) =>
      days.some((day) => day.day === orderedDay.name),
    ) ?? monday;

  return days.some((day) => day.day === monday.name)
    ? monday.name
    : firstAvailableDay.name;
}

export function DaySelector({
  ariaLabel,
  availableDays,
  selectedDayName,
  onSelectDay,
}: DaySelectorProps) {
  return (
    <div
      className="grid w-full max-w-[23rem] grid-cols-7 gap-1.5 sm:gap-2"
      role="tablist"
      aria-label={ariaLabel}
    >
      {orderedDays.map((day) => {
        const isAvailable = availableDays.has(day.name);
        const isSelected = selectedDayName === day.name;

        return (
          <button
            key={day.name}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={day.name}
            disabled={!isAvailable}
            onClick={() => onSelectDay(day.name)}
            className={[
              "flex aspect-square min-h-11 w-full touch-manipulation items-center justify-center rounded-full border text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-0.5 focus-visible:shadow-[0_0_0_4px_rgba(224,112,60,0.16)] active:translate-y-0 active:scale-95 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
              isSelected
                ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary)] text-white shadow-[0_10px_22px_rgba(107,127,74,0.18)]"
                : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)]",
              !isAvailable
                ? "cursor-not-allowed border-[color:var(--color-border)] bg-transparent text-[color:var(--color-border-strong)] opacity-65 hover:translate-y-0 hover:border-[color:var(--color-border)]"
                : "",
            ].join(" ")}
          >
            {day.shortName}
          </button>
        );
      })}
    </div>
  );
}
