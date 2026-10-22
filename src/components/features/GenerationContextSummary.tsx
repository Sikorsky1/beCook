import Link from "next/link";
import type { ReactNode } from "react";

import { allergyOptions, dietaryRestrictionOptions } from "@/components/features/ProfileFields";
import type { VerifiedFoodContext } from "@/lib/menu-generation/food-context";
import type { UserProfile } from "@/lib/supabase/profiles";

// «Generando para…» (D3, step 27): who and what the menu is created for, from the profile this
// page has loaded. It does not claim the restrictions were verified: the generator checks the
// name of each dish against them, not a full recipe (that is C2/C3).
// With `verified` (C1) it shows what the server read from the account and used for the proposal
// on screen (`foodContext` of /api/generate-menu) instead of the profile loaded by the page.
type GenerationContextSummaryProps =
  | {
      verified?: undefined;
      profile: UserProfile | null;
      peopleCount: number;
      styleLabels: string[];
      pantryCount: number;
      generating: boolean;
    }
  | { verified: VerifiedFoodContext; peopleCount: number };

function labelsFor<T extends string>(values: T[], options: { label: string; value: string }[]) {
  return values
    .filter((value) => value !== "none")
    .map((value) => options.find((option) => option.value === value)?.label ?? value);
}

function restrictionRows(food: {
  dietaryRestrictions: string[];
  allergies: string[];
  otherAllergies?: string | null;
  dislikedFoods: string[];
}) {
  const restrictions = labelsFor(food.dietaryRestrictions, dietaryRestrictionOptions);
  const allergies = [
    ...labelsFor(
      food.allergies.filter((allergy) => allergy !== "other"),
      allergyOptions,
    ),
    ...(food.otherAllergies?.trim() ? [food.otherAllergies.trim()] : []),
  ];
  const disliked = food.dislikedFoods.filter((item) => item.trim());
  return [
    { term: "Restricciones", value: restrictions.length ? restrictions.join(", ") : "Ninguna indicada" },
    { term: "Alergias", value: allergies.length ? allergies.join(", ") : "Ninguna indicada" },
    ...(disliked.length ? [{ term: "Evitar", value: disliked.join(", ") }] : []),
  ];
}

export function GenerationContextSummary(props: GenerationContextSummaryProps) {
  if (props.verified) {
    const { verified } = props;
    const rows = [
      { term: "Personas", value: String(verified.servings ?? props.peopleCount) },
      ...restrictionRows(verified),
    ];

    return (
      <SummaryFrame title="Generado para…" rows={rows}>
        Datos de tu cuenta con los que se ha creado esta propuesta. Comprobamos las restricciones con el nombre de
        cada plato y la receta del catálogo, que aún no ha revisado un profesional: revísala.{" "}
        <Link href="/profile" className="font-semibold underline underline-offset-2">
          Revisar perfil
        </Link>
      </SummaryFrame>
    );
  }

  const { profile, peopleCount, styleLabels, pantryCount, generating } = props;
  const rows = [
    { term: "Personas", value: String(peopleCount) },
    ...(profile
      ? restrictionRows(profile)
      : [
          { term: "Restricciones", value: "Sin perfil" },
          { term: "Alergias", value: "Sin perfil" },
        ]),
    { term: "Estilo", value: styleLabels.join(", ") },
    {
      term: "Despensa",
      value: pantryCount ? `${pantryCount} ${pantryCount === 1 ? "producto" : "productos"} que tienes` : "Sin productos marcados",
    },
  ];

  // Without a profile the menu cannot be created yet: the only note left says what is missing.
  return (
    <SummaryFrame title={generating ? "Generando para…" : "Se creará para…"} rows={rows}>
      {profile ? null : (
        <>
          Para crear un menú hace falta guardar tu perfil (comensales, restricciones y alergias).{" "}
          <Link href="/profile" className="font-semibold underline underline-offset-2">
            Completar perfil
          </Link>
        </>
      )}
    </SummaryFrame>
  );
}

function SummaryFrame({
  title,
  rows,
  children,
}: {
  title: string;
  rows: { term: string; value: string }[];
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title.replace("…", "")}
      className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3.5 py-3"
    >
      <p className="t-body-strong text-[color:var(--color-foreground)]">{title}</p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm leading-5">
        {rows.map((row) => (
          <div key={row.term} className="contents">
            <dt className="text-[color:var(--color-muted-foreground)]">{row.term}</dt>
            <dd className="min-w-0 break-words font-medium text-[color:var(--color-foreground)]">{row.value}</dd>
          </div>
        ))}
      </dl>
      {children ? <p className="t-meta mt-2">{children}</p> : null}
    </section>
  );
}
