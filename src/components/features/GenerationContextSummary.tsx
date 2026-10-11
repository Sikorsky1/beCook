import Link from "next/link";

import { allergyOptions, dietaryRestrictionOptions } from "@/components/features/ProfileFields";
import type { UserProfile } from "@/lib/supabase/profiles";

// «Generando para…» (D3, step 27): who and what the menu is created for, from the profile this
// page has loaded. It does not claim the restrictions were verified: the generator checks the
// name of each dish against them, not a full recipe (that is C2/C3).
type GenerationContextSummaryProps = {
  profile: UserProfile | null;
  peopleCount: number;
  styleLabels: string[];
  elaborationLabel: string;
  pantryCount: number;
  generating: boolean;
};

function labelsFor<T extends string>(values: T[], options: { label: string; value: string }[]) {
  return values
    .filter((value) => value !== "none")
    .map((value) => options.find((option) => option.value === value)?.label ?? value);
}

export function GenerationContextSummary({
  profile,
  peopleCount,
  styleLabels,
  elaborationLabel,
  pantryCount,
  generating,
}: GenerationContextSummaryProps) {
  const restrictions = profile ? labelsFor(profile.dietaryRestrictions, dietaryRestrictionOptions) : [];
  const allergies = profile
    ? [
        ...labelsFor(
          profile.allergies.filter((allergy) => allergy !== "other"),
          allergyOptions,
        ),
        ...(profile.otherAllergies?.trim() ? [profile.otherAllergies.trim()] : []),
      ]
    : [];
  const disliked = profile?.dislikedFoods.filter((food) => food.trim()) ?? [];

  const rows = [
    { term: "Personas", value: String(peopleCount) },
    {
      term: "Restricciones",
      value: profile ? (restrictions.length ? restrictions.join(", ") : "Ninguna indicada") : "Sin perfil",
    },
    {
      term: "Alergias",
      value: profile ? (allergies.length ? allergies.join(", ") : "Ninguna indicada") : "Sin perfil",
    },
    ...(disliked.length ? [{ term: "Evitar", value: disliked.join(", ") }] : []),
    { term: "Estilo", value: `${styleLabels.join(", ")} · ${elaborationLabel.toLowerCase()}` },
    {
      term: "Despensa",
      value: pantryCount ? `${pantryCount} ${pantryCount === 1 ? "producto" : "productos"} que tienes` : "Sin productos marcados",
    },
  ];

  return (
    <section
      aria-label={generating ? "Generando para" : "Se creará para"}
      className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3.5 py-3"
    >
      <p className="t-body-strong text-[color:var(--color-foreground)]">
        {generating ? "Generando para…" : "Se creará para…"}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm leading-5">
        {rows.map((row) => (
          <div key={row.term} className="contents">
            <dt className="text-[color:var(--color-muted-foreground)]">{row.term}</dt>
            <dd className="min-w-0 break-words font-medium text-[color:var(--color-foreground)]">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="t-meta mt-2">
        {profile
          ? "Según tu perfil. Comprobamos las restricciones por el nombre de cada plato, no por su receta: revisa la propuesta."
          : "Sin perfil, el menú no tiene en cuenta restricciones ni alergias."}{" "}
        <Link href="/profile" className="font-semibold underline underline-offset-2">
          {profile ? "Revisar perfil" : "Completar perfil"}
        </Link>
      </p>
    </section>
  );
}
