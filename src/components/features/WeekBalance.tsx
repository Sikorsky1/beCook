import { weekSummary } from "@/lib/menu-generation/week-summary";

// What a week has, in positive (N10): a line of highlights, a suggestion when something is missing
// and a «¿Por qué?» with the source. Informative: no calories, no colours of «bien/mal».
export function WeekBalance({
  dishes,
  profile,
}: {
  dishes: string[];
  profile: { dietaryRestrictions: string[]; goals: string[] } | null;
}) {
  const summary = weekSummary(dishes, profile ?? { dietaryRestrictions: [], goals: [] });
  if (!summary || !summary.highlights.length) return null;

  return (
    <section
      aria-label="Lo que tiene tu semana"
      className="space-y-1.5 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3.5 py-3"
    >
      <p className="t-body-strong text-[color:var(--color-foreground)]">Tu semana tiene</p>
      <p className="t-body text-[color:var(--color-foreground)]">{summary.highlights.join(" · ")}</p>
      {summary.suggestions.map((suggestion) => (
        <p key={suggestion} className="t-meta">
          {suggestion}
        </p>
      ))}
      <details>
        <summary className="t-meta min-h-11 cursor-pointer content-center font-semibold">¿Por qué?</summary>
        <ul className="t-meta mt-1 space-y-1">
          {summary.reasons.map((reason) => (
            <li key={reason.topic}>
              <span className="font-semibold">{reason.topic}:</span> {reason.text} <span>({reason.source})</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
