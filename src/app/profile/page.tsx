"use client";

import { Check, ChevronDown, LogOut, Save } from "lucide-react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { useIdentity, useIdentityActions } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { Button, PrimaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { loadProfile, readCachedProfile, saveProfile } from "@/lib/data/repositories";
import { loginHrefFor } from "@/lib/navigation";
import {
  applySection,
  buildNewProfile,
  draftFromProfile,
  emptyProfileDraft,
  issuesBySection,
  profileSectionInfo,
  profileSections,
  readStoredProfile,
  resetSections,
  sectionStatus,
  toggleRestriction,
  type ProfileDraft,
  type ProfileSection,
  type SectionStatus,
} from "@/lib/profileForm";
import { scopeHasPendingChanges } from "@/lib/storage/scoped-storage";
import {
  PROFILE_LIMITS,
  normalizeDislikedFoods,
  serializeDislikedFoods,
  type Allergy,
  type DietaryRestriction,
  type Goal,
  type ProfileValidationIssue,
  type Sex,
  type TrainingType,
  type UserProfile,
  type WeeklyTrainingDays,
} from "@/lib/supabase/profiles";
import { pageShellClass } from "@/lib/ui";

const dislikedFoodsMaxLength = PROFILE_LIMITS.dislikedFoodsMaxLength;
const otherGoalMaxLength = PROFILE_LIMITS.otherGoalMaxLength;

const sexOptions: { label: string; value: Sex }[] = [
  { label: "Hombre", value: "male" },
  { label: "Mujer", value: "female" },
];

const householdOptions = [1, 2, 3, 4, 5, 6].map((value) => ({
  label: String(value),
  value,
}));

const trainingTypeOptions: { label: string; value: TrainingType }[] = [
  { label: "Fuerza", value: "strength" },
  { label: "CrossFit", value: "crossfit" },
  { label: "Hyrox", value: "hyrox" },
  { label: "Running", value: "running" },
  { label: "Ciclismo", value: "cycling" },
  { label: "Pádel", value: "padel" },
  { label: "Natación", value: "swimming" },
  { label: "Deportes de equipo", value: "team_sports" },
  { label: "Senderismo / montaña", value: "hiking" },
  { label: "Yoga / Pilates", value: "yoga_pilates" },
  { label: "Otro", value: "other" },
];

const goalOptions: { label: string; value: Goal }[] = [
  { label: "Perder grasa", value: "fat_loss" },
  { label: "Ganar masa muscular", value: "muscle_gain" },
  { label: "Mejorar rendimiento deportivo", value: "sports_performance" },
  { label: "Comer más saludable", value: "healthy_eating" },
  { label: "Otro", value: "other" },
];

const dietaryRestrictionOptions: { label: string; value: DietaryRestriction }[] = [
  { label: "Ninguna", value: "none" },
  { label: "Vegetariano", value: "vegetarian" },
  { label: "Vegano", value: "vegan" },
  { label: "Pescetariano", value: "pescatarian" },
  { label: "Sin cerdo", value: "no_pork" },
  { label: "Sin alcohol", value: "no_alcohol" },
];

const noAllergiesValue = "none";

const allergyOptions: { label: string; value: Allergy | typeof noAllergiesValue }[] = [
  { label: "Ninguna", value: noAllergiesValue },
  { label: "Gluten", value: "gluten" },
  { label: "Lactosa", value: "lactose" },
  { label: "Frutos secos", value: "nuts" },
  { label: "Marisco", value: "shellfish" },
  { label: "Huevo", value: "egg" },
  { label: "Otra", value: "other" },
];

const statusLabels: Record<SectionStatus, string> = {
  pending: "Pendiente",
  unsaved: "Sin guardar",
  saved: "Guardado",
};

// Length of what the database will store, which is what profiles_disliked_foods_check limits.
function storedDislikedFoodsLength(value: string) {
  return (serializeDislikedFoods(normalizeDislikedFoods([value])) ?? "").length;
}

function toWeeklyTrainingDays(value: number): WeeklyTrainingDays {
  const { min, max } = PROFILE_LIMITS.weeklyTrainingDays;

  return Math.min(Math.max(value, min), max) as WeeklyTrainingDays;
}

function FieldLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span id={id} className="t-body-strong text-[color:var(--color-foreground)]">
      {children}
    </span>
  );
}

const compactInputClass =
  "w-full rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5 text-[0.78rem] font-medium text-[color:var(--color-foreground)] outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)]";

const chipBaseClass =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border px-3 py-1.5 text-center text-[0.78rem] font-semibold leading-tight transition-colors focus-within:shadow-[0_0_0_3px_rgba(224,112,60,0.2)]";

function ChoiceChips<T extends string | number>({
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
              className={`${chipBaseClass} ${type === "radio" ? "min-w-10" : ""} ${
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

function StatusBadge({ status }: { status: SectionStatus }) {
  const tone =
    status === "saved"
      ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-secondary-hover)]"
      : status === "unsaved"
        ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]"
        : "border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)]";

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${tone}`}>
      {statusLabels[status]}
    </span>
  );
}

type SectionSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved-local" | "saved-remote" | "pending" | "conflict" }
  | { status: "invalid"; issues: ProfileValidationIssue[] };

function SectionFeedback({ state }: { state: SectionSaveState | undefined }) {
  if (!state || state.status === "idle") {
    return null;
  }

  if (state.status === "invalid") {
    return (
      <div role="alert" className="space-y-1 text-[0.78rem] font-semibold text-[color:var(--color-danger)]">
        {state.issues.map((issue) => (
          <p key={`${issue.field}-${issue.message}`}>{issue.message}</p>
        ))}
      </div>
    );
  }

  const messages: Record<Exclude<SectionSaveState["status"], "idle" | "invalid">, string> = {
    saving: "Guardando…",
    "saved-remote": "Guardado en tu cuenta",
    "saved-local": "Guardado en este dispositivo",
    pending: "No se pudo guardar en tu cuenta. El cambio queda pendiente en este dispositivo y se reintentará.",
    conflict: "Tu cuenta tenía una versión más reciente: se muestra esa. Revisa y vuelve a guardar.",
  };
  const isProblem = state.status === "pending" || state.status === "conflict";

  return (
    <p
      role="status"
      className={`inline-flex items-center gap-2 text-[0.78rem] font-semibold ${
        isProblem ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-secondary-hover)]"
      }`}
    >
      {state.status === "saved-remote" || state.status === "saved-local" ? (
        <Check aria-hidden="true" className="h-4 w-4" />
      ) : null}
      {messages[state.status]}
    </p>
  );
}

function SectionCard({
  section,
  status,
  children,
  footer,
}: {
  section: ProfileSection;
  status: SectionStatus;
  children: ReactNode;
  footer: ReactNode;
}) {
  const info = profileSectionInfo[section];

  return (
    <Card className="space-y-3 p-3.5 sm:p-4" aria-labelledby={`section-${section}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={`section-${section}`} className="t-h2 min-w-0 text-[color:var(--color-foreground)]">
          {info.title}
        </h2>
        <StatusBadge status={status} />
      </div>
      <p className="t-meta">{info.usage}</p>
      {children}
      {footer}
    </Card>
  );
}

export default function ProfilePage() {
  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);
  const [saveStates, setSaveStates] = useState<Partial<Record<ProfileSection | "all", SectionSaveState>>>({});
  const [isBodyOpen, setIsBodyOpen] = useState(false);
  const identity = useIdentity();
  const { signOut } = useIdentityActions();
  const userEmail = identity.email;
  const [syncState, setSyncState] = useState<SyncState>({});
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const isSaving = Object.values(saveStates).some((state) => state?.status === "saving");
  const dislikedFoodsCharacters = useMemo(
    () => storedDislikedFoodsLength(draft.dislikedFoodsText),
    [draft.dislikedFoodsText],
  );
  const dislikedFoodsTooLong = dislikedFoodsCharacters > dislikedFoodsMaxLength;
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        profileSections.map((section) => [section, sectionStatus(draft, savedProfile, section)]),
      ) as Record<ProfileSection, SectionStatus>,
    [draft, savedProfile],
  );
  const pendingSections = profileSections.filter(
    (section) => profileSectionInfo[section].required && statuses[section] === "pending",
  );

  useEffect(() => {
    // Identity first; every sign-in, sign-out or user switch reloads the form for that identity.
    if (identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const applyProfile = (value: unknown) => {
      const profile = readStoredProfile(value);
      setSavedProfile(profile);
      setDraft(draftFromProfile(profile));
    };

    const loadTimer = window.setTimeout(() => {
      setSaveStates({});
      setSyncState({});
      setConfirmSignOut(false);
      setIsBodyOpen(false);
      applyProfile(readCachedProfile(dataIdentity));
      setHasLoadedProfile(!dataIdentity.userId);

      void loadProfile(dataIdentity).then((result) => {
        if (isCancelled) {
          return;
        }

        applyProfile(result.data);
        setSyncState({
          offline: result.offline,
          discardedLocalChanges: result.discardedLocalChanges,
          pending: result.pending,
        });
        setHasLoadedProfile(true);
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch]);

  const updateDraft = (section: ProfileSection, updates: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
    setSaveStates((current) => ({ ...current, [section]: { status: "idle" }, all: { status: "idle" } }));
  };

  // Saves one section on top of the saved profile, or the whole profile the first time.
  const save = async (target: ProfileSection | "all") => {
    const sections = target === "all" ? profileSections : [target];
    const built = target === "all" || !savedProfile
      ? buildNewProfile(draft)
      : applySection(savedProfile, draft, target);

    if (!built.ok) {
      setSaveStates((current) => ({ ...current, [target]: { status: "invalid", issues: built.issues } }));
      if (issuesBySection(built.issues).body) {
        setIsBodyOpen(true);
      }
      return;
    }

    setSaveStates((current) => ({ ...current, [target]: { status: "saving" } }));
    setSyncState({});

    const result = await saveProfile({ scope: identity.scope, userId: identity.userId }, built.profile);

    if (result.status === "conflict") {
      const remoteProfile = readStoredProfile(result.remoteData);
      setSavedProfile(remoteProfile);
      setDraft((current) => resetSections(current, remoteProfile, sections));
      setSyncState({ conflict: true });
      setSaveStates((current) => ({ ...current, [target]: { status: "conflict" } }));
      return;
    }

    // local, synced and pending all keep this profile in the device copy.
    setSavedProfile(built.profile);
    setDraft((current) => resetSections(current, built.profile, sections));
    setSaveStates((current) => ({
      ...current,
      [target]: {
        status: result.status === "local" ? "saved-local" : result.status === "synced" ? "saved-remote" : "pending",
      },
    }));
    if (result.status === "pending") {
      setSyncState({ pending: true });
    }
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save("all");
  };

  const sectionFooter = (section: ProfileSection) => {
    if (!savedProfile) {
      return null;
    }

    const state = saveStates[section];
    const canSave = statuses[section] !== "saved" && !isSaving;

    return (
      <div className="flex flex-col gap-2 border-t border-[color:var(--color-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5">
          <SectionFeedback state={state} />
        </div>
        <Button
          type="button"
          variant={statuses[section] === "saved" ? "soft" : "primary"}
          size="sm"
          disabled={!canSave}
          onClick={() => void save(section)}
          className="w-full rounded-full sm:w-auto"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {state?.status === "saving" ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    );
  };

  const handleSignOut = async () => {
    // Unsynced changes would be lost with the device cache: ask first.
    if (!confirmSignOut && scopeHasPendingChanges(identity.scope)) {
      setConfirmSignOut(true);
      return;
    }

    setIsSigningOut(true);

    try {
      await signOut();
    } catch (error: unknown) {
      console.warn(
        "No se pudo cerrar sesión:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      setIsSigningOut(false);
      setConfirmSignOut(false);
    }
  };

  const goalSummary = savedProfile
    ? goalOptions.find((option) => option.value === savedProfile.goals[0])?.label ?? "Sin objetivo"
    : "Perfil sin guardar";
  const householdSummary = savedProfile
    ? `${savedProfile.householdSize} ${savedProfile.householdSize === 1 ? "persona" : "personas"}`
    : null;

  return (
    <main
      className={`${pageShellClass} px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-6`}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <section className="sticky top-0 z-30 -mx-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div>
            <p className="t-eyebrow">Perfil</p>
            <h1 className="t-h1 mt-2 text-[color:var(--color-foreground)]">
              Lo que necesita tu menú
            </h1>
          </div>
        </section>

        <Card className="space-y-3 p-3.5 sm:p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-soft)] text-lg font-semibold text-[color:var(--color-accent)]"
            >
              {(userEmail?.[0] ?? "B").toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="t-body-strong truncate text-[color:var(--color-foreground)]">
                {userEmail ?? "Modo local"}
              </p>
              <p className="t-meta mt-0.5">
                {householdSummary ? `${goalSummary} · ${householdSummary}` : goalSummary}
              </p>
            </div>
          </div>
          {hasLoadedProfile && pendingSections.length > 0 ? (
            <p className="t-meta">
              <span className="font-semibold text-[color:var(--color-foreground)]">Falta por completar:</span>{" "}
              {pendingSections.map((section) => profileSectionInfo[section].title.replace(/^¿|\?$/g, "")).join(" · ")}
            </p>
          ) : null}
          {!hasLoadedProfile ? <p className="t-meta">Cargando perfil</p> : null}
          {/* The bottom bar goes away after the first save; its result stays visible here. */}
          {savedProfile ? <SectionFeedback state={saveStates.all} /> : null}
        </Card>

        <form onSubmit={handleCreate} className="space-y-3 sm:space-y-4" noValidate>
          <SectionCard section="household" status={statuses.household} footer={sectionFooter("household")}>
            <ChoiceChips
              legend="Personas"
              name="household"
              type="radio"
              options={householdOptions}
              isSelected={(value) => draft.householdSize === value}
              onToggle={(householdSize) => updateDraft("household", { householdSize })}
            />
          </SectionCard>

          <SectionCard section="goals" status={statuses.goals} footer={sectionFooter("goals")}>
            <ChoiceChips
              legend="Elige uno o varios"
              name="goals"
              options={goalOptions}
              isSelected={(value) => draft.goals.includes(value)}
              onToggle={(value) => {
                const goals = draft.goals.includes(value)
                  ? draft.goals.filter((goal) => goal !== value)
                  : [...draft.goals, value];
                updateDraft("goals", { goals, otherGoal: goals.includes("other") ? draft.otherGoal : "" });
              }}
            />
            {draft.goals.includes("other") ? (
              <label className="block space-y-1.5">
                <FieldLabel>Cuéntanos tu objetivo</FieldLabel>
                <textarea
                  value={draft.otherGoal}
                  maxLength={otherGoalMaxLength}
                  placeholder="Ejemplo: mejorar digestiones, organizar comidas familiares o cuidar energía diaria."
                  onChange={(event) =>
                    updateDraft("goals", { otherGoal: event.target.value.slice(0, otherGoalMaxLength) })
                  }
                  className={`${compactInputClass} min-h-20 resize-y leading-5 placeholder:text-xs placeholder:italic placeholder:text-[color:var(--color-muted-foreground)]`}
                />
                <span className="block text-right text-[0.68rem] font-semibold text-[color:var(--color-muted-foreground)]">
                  {draft.otherGoal.length}/{otherGoalMaxLength}
                </span>
              </label>
            ) : null}
          </SectionCard>

          <SectionCard section="restrictions" status={statuses.restrictions} footer={sectionFooter("restrictions")}>
            <ChoiceChips
              legend="Restricciones alimentarias"
              name="dietary-restrictions"
              options={dietaryRestrictionOptions}
              isSelected={(value) => draft.dietaryRestrictions.includes(value)}
              onToggle={(value) =>
                updateDraft("restrictions", {
                  dietaryRestrictions: toggleRestriction(draft.dietaryRestrictions, value),
                })
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
                  updateDraft("restrictions", {
                    noAllergies: !draft.noAllergies,
                    allergies: [],
                    otherAllergies: "",
                  });
                  return;
                }

                const allergies = draft.allergies.includes(value)
                  ? draft.allergies.filter((allergy) => allergy !== value)
                  : [...draft.allergies, value];
                updateDraft("restrictions", {
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
                  onChange={(event) => updateDraft("restrictions", { otherAllergies: event.target.value })}
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
                onChange={(event) => updateDraft("restrictions", { dislikedFoodsText: event.target.value })}
                className={`${compactInputClass} min-h-20 resize-y leading-5 placeholder:text-xs placeholder:italic placeholder:text-[color:var(--color-muted-foreground)]`}
              />
              <span
                id="disliked-foods-count"
                className={`block text-right text-[0.68rem] font-semibold ${
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
          </SectionCard>

          <SectionCard section="training" status={statuses.training} footer={sectionFooter("training")}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5">
              <FieldLabel id="training-days-label">Días que entrenas a la semana</FieldLabel>
              <div
                role="group"
                aria-labelledby="training-days-label"
                className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-surface-muted)] p-1"
              >
                <button
                  type="button"
                  disabled={draft.weeklyTrainingDays === 0}
                  onClick={() =>
                    updateDraft("training", { weeklyTrainingDays: toWeeklyTrainingDays(draft.weeklyTrainingDays - 1) })
                  }
                  aria-label="Reducir días de entrenamiento"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  -
                </button>
                <span aria-live="polite" className="min-w-10 text-center text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                  {draft.weeklyTrainingDays}
                </span>
                <button
                  type="button"
                  disabled={draft.weeklyTrainingDays === 7}
                  onClick={() =>
                    updateDraft("training", { weeklyTrainingDays: toWeeklyTrainingDays(draft.weeklyTrainingDays + 1) })
                  }
                  aria-label="Aumentar días de entrenamiento"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  +
                </button>
              </div>
            </div>

            <ChoiceChips
              legend="Tipos de entrenamiento"
              name="training-types"
              options={trainingTypeOptions}
              isSelected={(value) => draft.trainingTypes.includes(value)}
              onToggle={(value) => {
                const trainingTypes = draft.trainingTypes.includes(value)
                  ? draft.trainingTypes.filter((type) => type !== value)
                  : [...draft.trainingTypes, value];
                updateDraft("training", {
                  trainingTypes,
                  otherTrainingType: trainingTypes.includes("other") ? draft.otherTrainingType : "",
                });
              }}
            />

            {draft.trainingTypes.includes("other") ? (
              <label className="block space-y-1.5">
                <FieldLabel>Otro entrenamiento</FieldLabel>
                <input
                  type="text"
                  value={draft.otherTrainingType}
                  onChange={(event) => updateDraft("training", { otherTrainingType: event.target.value })}
                  className={compactInputClass}
                />
              </label>
            ) : null}
          </SectionCard>

          <SectionCard section="body" status={statuses.body} footer={sectionFooter("body")}>
            <button
              type="button"
              aria-expanded={isBodyOpen}
              aria-controls="body-fields"
              onClick={() => setIsBodyOpen((open) => !open)}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[0.78rem] font-semibold text-[color:var(--color-foreground)]"
            >
              {isBodyOpen ? "Ocultar datos corporales" : "Mostrar datos corporales"}
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${isBodyOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isBodyOpen ? (
              <div id="body-fields" className="space-y-3">
                <ChoiceChips
                  legend="Sexo"
                  name="sex"
                  type="radio"
                  options={sexOptions}
                  isSelected={(value) => draft.sex === value}
                  onToggle={(sex) => updateDraft("body", { sex })}
                />

                <label className="block space-y-1.5">
                  <FieldLabel>Fecha de nacimiento</FieldLabel>
                  <input
                    type="date"
                    value={draft.birthDate}
                    onChange={(event) => updateDraft("body", { birthDate: event.target.value })}
                    className={compactInputClass}
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block min-w-0 space-y-1.5">
                    <FieldLabel>Altura</FieldLabel>
                    <span className="relative block">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        placeholder={`${PROFILE_LIMITS.heightCm.min}–${PROFILE_LIMITS.heightCm.max}`}
                        value={draft.heightCm}
                        onChange={(event) => updateDraft("body", { heightCm: event.target.value })}
                        className={`${compactInputClass} pr-10`}
                      />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[0.78rem] font-semibold text-[color:var(--color-muted-foreground)]">
                        cm
                      </span>
                    </span>
                  </label>

                  <label className="block min-w-0 space-y-1.5">
                    <FieldLabel>Peso</FieldLabel>
                    <span className="relative block">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        placeholder={`${PROFILE_LIMITS.weightKg.min}–${PROFILE_LIMITS.weightKg.max}`}
                        value={draft.weightKg}
                        onChange={(event) => updateDraft("body", { weightKg: event.target.value })}
                        className={`${compactInputClass} pr-10`}
                      />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[0.78rem] font-semibold text-[color:var(--color-muted-foreground)]">
                        kg
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <Card className="space-y-3 p-3.5 sm:p-4">
            <h2 className="t-h2 text-[color:var(--color-foreground)]">Cuenta</h2>
            {userEmail ? <SyncNotice state={syncState} /> : null}
            {confirmSignOut ? (
              <p className="t-meta text-[color:var(--color-danger)]">
                Hay cambios sin guardar en tu cuenta. Si cierras sesión ahora, se perderán en este dispositivo.
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="t-meta min-w-0 truncate">
                {userEmail ?? "Modo local"}
              </p>

              {userEmail ? (
                <Button
                  variant="danger"
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={isSigningOut}
                  className="rounded-full sm:w-auto"
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" />
                  {confirmSignOut ? "Cerrar sesión igualmente" : "Cerrar sesión"}
                </Button>
              ) : (
                <Link
                  href={loginHrefFor("/profile")}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-xs font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
                >
                  Entrar o crear cuenta
                </Link>
              )}
            </div>
          </Card>

          {!savedProfile && hasLoadedProfile ? (
            <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 -mx-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-5 min-w-0">
                  <SectionFeedback state={saveStates.all} />
                </div>
                <PrimaryButton
                  type="submit"
                  disabled={isSaving}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <Save aria-hidden="true" className="h-4 w-4" />
                  {saveStates.all?.status === "saving" ? "Guardando…" : "Guardar perfil"}
                </PrimaryButton>
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </main>
  );
}
