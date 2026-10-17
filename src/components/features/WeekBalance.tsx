"use client";

import { useEffect, useId, useState } from "react";

import { weekSummary } from "@/lib/menu-generation/week-summary";
import { loadCatalogTags, type TagsLookup } from "@/lib/recipes/loadCatalogTags";

// What a week has, in positive (N10): a line of highlights, a suggestion when something is missing
// and a «¿Por qué?» with the source. Informative: no calories, no colours of «bien/mal».
export function WeekBalance({
  dishes,
  profile,
}: {
  dishes: string[];
  profile: { dietaryRestrictions: string[]; goals: string[] } | null;
}) {
  const headingId = `${useId()}-week-balance`;
  const [tagsOf, setTagsOf] = useState<{ lookup: TagsLookup } | null>(null);
  useEffect(() => {
    let active = true;
    loadCatalogTags()
      .then((lookup) => {
        if (active) setTagsOf({ lookup });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!tagsOf) return null;
  const summary = weekSummary(dishes, profile ?? { dietaryRestrictions: [], goals: [] }, tagsOf.lookup);
  if (!summary || !summary.highlights.length) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-1.5 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3.5 py-3"
    >
      <h3 id={headingId} className="t-body-strong text-[color:var(--color-foreground)]">
        Tu semana tiene
      </h3>
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
