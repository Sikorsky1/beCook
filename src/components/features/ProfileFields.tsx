"use client";

import type { ReactNode } from "react";

import { toggleRestriction, type ProfileDraft } from "@/lib/profileForm";
import {
  PROFILE_LIMITS,
  normalizeDislikedFoods,
  serializeDislikedFoods,
  type Allergy,
  type DietaryRestriction,
  type Goal,
} from "@/lib/supabase/profiles";

// Fields shared by Perfil and the onboarding: household, goals, restrictions and allergies.
// Nothing is selected unless the draft says so.
const dislikedFoodsMaxLength = PROFILE_LIMITS.dislikedFoodsMaxLength;
const otherGoalMaxLength = PROFILE_LIMITS.otherGoalMaxLength;

export const householdOptions = [1, 2, 3, 4, 5, 6].map((value) => ({
  label: String(value),
  value,
}));

export const goalOptions: { label: string; value: Goal }[] = [
  { label: "Perder grasa", value: "fat_loss" },
  { label: "Ganar masa muscular", value: "muscle_gain" },
  { label: "Mejorar rendimiento deportivo", value: "sports_performance" },
  { label: "Comer más saludable", value: "healthy_eating" },
  { label: "Otro", value: "other" },
];

export const dietaryRestrictionOptions: { label: string; value: DietaryRestriction }[] = [
  { label: "Ninguna", value: "none" },
  { label: "Vegetariano", value: "vegetarian" },
  { label: "Vegano", value: "vegan" },
  { label: "Pescetariano", value: "pescatarian" },
  { label: "Sin cerdo", value: "no_pork" },
  { label: "Sin alcohol", value: "no_alcohol" },
];

const noAllergiesValue = "none";

export const allergyOptions: { label: string; value: Allergy | typeof noAllergiesValue }[] = [
  { label: "Ninguna", value: noAllergiesValue },
  { label: "Gluten", value: "gluten" },
  { label: "Lactosa", value: "lactose" },
  { label: "Frutos secos", value: "nuts" },
  { label: "Marisco", value: "shellfish" },
  { label: "Huevo", value: "egg" },
  { label: "Otra", value: "other" },
];

export function FieldLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span id={id} className="t-body-strong text-[color:var(--color-foreground)]">
      {children}
    </span>
  );
}

export const compactInputClass =
  "w-full rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5 text-base font-medium text-[color:var(--color-foreground)] transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)]";

const chipBaseClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3.5 py-2 text-center text-sm font-semibold leading-tight transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[color:var(--color-accent)]";

export function ChoiceChips<T extends string | number>({
  legend,
  name,
  type = "checkbox",
  options,
  isSelected,
  onToggle,
}: {
  legend: string;
  name: string;
  type?: "checkbox" | "radio";
  options: { label: string; value: T }[];
  isSelected: (value: T) => boolean;
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="t-body-strong mb-2 text-[color:var(--color-foreground)]">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const checked = isSelected(option.value);

          return (
            <label
              key={String(option.value)}
              className={`${chipBaseClass} ${type === "radio" ? "min-w-11" : ""} ${
                checked
                  ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-foreground)]"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)]"
              }`}
            >
              <input
                type={type}
                name={name}
                checked={checked}
                onChange={() => onToggle(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type FieldsProps = {
  draft: ProfileDraft;
  onChange: (updates: Partial<ProfileDraft>) => void;
};

export function HouseholdField({ draft, onChange }: FieldsProps) {
  return (
    <ChoiceChips
      legend="Personas"
      name="household"
      type="radio"
      options={householdOptions}
      isSelected={(value) => draft.householdSize === value}
      onToggle={(householdSize) => onChange({ householdSize })}
    />
  );
}

export function GoalsField({ draft, onChange }: FieldsProps) {
  return (
    <>
      <ChoiceChips
        legend="Elige uno o varios"
        name="goals"
        options={goalOptions}
        isSelected={(value) => draft.goals.includes(value)}
        onToggle={(value) => {
          const goals = draft.goals.includes(value)
            ? draft.goals.filter((goal) => goal !== value)
            : [...draft.goals, value];
          onChange({ goals, otherGoal: goals.includes("other") ? draft.otherGoal : "" });
        }}
      />
      {draft.goals.includes("other") ? (
        <label className="block space-y-1.5">
          <FieldLabel>Cuéntanos tu objetivo</FieldLabel>
          <textarea
            value={draft.otherGoal}
            maxLength={otherGoalMaxLength}
            placeholder="Ejemplo: mejorar digestiones, organizar comidas familiares o cuidar energía diaria."
            onChange={(event) => onChange({ otherGoal: event.target.value.slice(0, otherGoalMaxLength) })}
            className={`${compactInputClass} min-h-24 resize-y leading-6 placeholder:italic placeholder:text-[color:var(--color-muted-foreground)]`}
          />
          <span className="t-meta block text-right font-semibold">
            {draft.otherGoal.length}/{otherGoalMaxLength}
          </span>
        </label>
      ) : null}
    </>
  );
}

// Length of what the database will store, which is what profiles_disliked_foods_check limits.
function storedDislikedFoodsLength(value: string) {
  return (serializeDislikedFoods(normalizeDislikedFoods([value])) ?? "").length;
}

export function RestrictionsFields({ draft, onChange }: FieldsProps) {
  const dislikedFoodsCharacters = storedDislikedFoodsLength(draft.dislikedFoodsText);
  const dislikedFoodsTooLong = dislikedFoodsCharacters > dislikedFoodsMaxLength;

  return (
    <>
      <ChoiceChips
        legend="Restricciones alimentarias"
        name="dietary-restrictions"
        options={dietaryRestrictionOptions}
        isSelected={(value) => draft.dietaryRestrictions.includes(value)}
        onToggle={(value) =>
          onChange({ dietaryRestrictions: toggleRestriction(draft.dietaryRestrictions, value) })
        }
      />

      <ChoiceChips
        legend="Alergias"
        name="allergies"
        options={allergyOptions}
        isSelected={(value) =>
          value === noAllergiesValue ? draft.noAllergies : draft.allergies.includes(value)
        }
        onToggle={(value) => {
          if (value === noAllergiesValue) {
            onChange({ noAllergies: !draft.noAllergies, allergies: [], otherAllergies: "" });
            return;
          }

          const allergies = draft.allergies.includes(value)
            ? draft.allergies.filter((allergy) => allergy !== value)
            : [...draft.allergies, value];
          onChange({
            noAllergies: false,
            allergies,
            otherAllergies: allergies.includes("other") ? draft.otherAllergies : "",
          });
        }}
      />

      {!draft.noAllergies && draft.allergies.includes("other") ? (
        <label className="block space-y-1.5">
          <FieldLabel>Otras alergias</FieldLabel>
          <input
            type="text"
            value={draft.otherAllergies}
            onChange={(event) => onChange({ otherAllergies: event.target.value })}
            className={compactInputClass}
          />
        </label>
      ) : null}

      <label className="block space-y-1.5">
        <FieldLabel>Alimentos que no te gustan</FieldLabel>
        <span className="t-meta block">Opcional. Sepáralos con comas.</span>
        <textarea
          value={draft.dislikedFoodsText}
          aria-invalid={dislikedFoodsTooLong}
          aria-describedby="disliked-foods-count"
          placeholder="Ejemplo: brócoli, setas"
          onChange={(event) => onChange({ dislikedFoodsText: event.target.value })}
          className={`${compactInputClass} min-h-24 resize-y leading-6 placeholder:italic placeholder:text-[color:var(--color-muted-foreground)]`}
        />
        <span
          id="disliked-foods-count"
          className={`t-meta block text-right font-semibold ${
            dislikedFoodsTooLong
              ? "text-[color:var(--color-danger)]"
              : "text-[color:var(--color-muted-foreground)]"
          }`}
        >
          {dislikedFoodsTooLong
            ? `${dislikedFoodsCharacters}/${dislikedFoodsMaxLength} · Acorta la lista para poder guardar`
            : `${dislikedFoodsCharacters}/${dislikedFoodsMaxLength}`}
        </span>
      </label>
    </>
  );
}
