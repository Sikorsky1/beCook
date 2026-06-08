"use client";

import { Check, LogOut, Save } from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import { PrimaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type {
  Allergy,
  DietaryRestriction,
  Goal,
  Sex,
  TrainingType,
  UserProfile,
  WeeklyTrainingDays,
} from "@/lib/supabase/profiles";
import { pageShellClass } from "@/lib/ui";

const PROFILE_STORAGE_KEY = "becook-profile";
const dislikedFoodsMaxLength = 150;
const otherGoalMaxLength = 150;

const defaultProfile: UserProfile = {
  sex: "male",
  birthDate: "",
  heightCm: 175,
  weightKg: 75,
  householdSize: 2,
  weeklyTrainingDays: 0,
  trainingTypes: [],
  otherTrainingType: "",
  goals: ["healthy_eating"],
  goal: "healthy_eating",
  otherGoal: "",
  dietaryRestrictions: ["none"],
  allergies: [],
  otherAllergies: "",
  dislikedFoods: [],
};

const sexOptions: { label: string; value: Sex }[] = [
  { label: "Hombre", value: "male" },
  { label: "Mujer", value: "female" },
];

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

const dietaryRestrictionOptions: {
  label: string;
  value: DietaryRestriction;
}[] = [
  { label: "Ninguna", value: "none" },
  { label: "Vegetariano", value: "vegetarian" },
  { label: "Vegano", value: "vegan" },
  { label: "Pescetariano", value: "pescatarian" },
  { label: "Sin cerdo", value: "no_pork" },
  { label: "Sin alcohol", value: "no_alcohol" },
];

const allergyOptions: { label: string; value: Allergy }[] = [
  { label: "Gluten", value: "gluten" },
  { label: "Lactosa", value: "lactose" },
  { label: "Frutos secos", value: "nuts" },
  { label: "Marisco", value: "shellfish" },
  { label: "Huevo", value: "egg" },
  { label: "Otra", value: "other" },
];

function getNumberOptions(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const profile = value as Partial<UserProfile>;

  return (
    typeof profile.sex === "string" &&
    typeof profile.birthDate === "string" &&
    typeof profile.heightCm === "number" &&
    typeof profile.weightKg === "number" &&
    typeof profile.householdSize === "number" &&
    typeof profile.weeklyTrainingDays === "number" &&
    Number.isInteger(profile.weeklyTrainingDays) &&
    profile.weeklyTrainingDays >= 0 &&
    profile.weeklyTrainingDays <= 7 &&
    Array.isArray(profile.trainingTypes) &&
    (Array.isArray(profile.goals) || typeof profile.goal === "string") &&
    Array.isArray(profile.dietaryRestrictions) &&
    Array.isArray(profile.allergies) &&
    Array.isArray(profile.dislikedFoods)
  );
}

function normalizeGoals(
  goals: unknown,
  legacyGoal: unknown,
): Goal[] {
  const rawGoals = Array.isArray(goals) ? goals : [legacyGoal];
  const normalizedGoals = rawGoals
    .map((goal) => (goal === "maintenance" ? "healthy_eating" : goal))
    .filter((goal): goal is Goal =>
      goalOptions.some((option) => option.value === goal),
    );

  return Array.from(new Set(normalizedGoals));
}

function normalizeProfile(profile: UserProfile): UserProfile {
  const goals = normalizeGoals(profile.goals, profile.goal);
  const normalizedGoals = goals.length > 0 ? goals : defaultProfile.goals;

  return {
    ...defaultProfile,
    ...profile,
    goals: normalizedGoals,
    goal: normalizedGoals[0] ?? "healthy_eating",
    otherGoal: normalizedGoals.includes("other")
      ? profile.otherGoal?.slice(0, otherGoalMaxLength) ?? ""
      : "",
  };
}

function readSavedProfile() {
  if (typeof window === "undefined") {
    return null;
  }

  const savedProfile = window.localStorage.getItem(PROFILE_STORAGE_KEY);

  if (!savedProfile) {
    return null;
  }

  try {
    const parsedProfile = JSON.parse(savedProfile);

    return isProfile(parsedProfile) ? normalizeProfile(parsedProfile) : null;
  } catch {
    return null;
  }
}

function saveProfile(profile: UserProfile) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

type ProfileSyncResult =
  | { status: "remote"; profile: UserProfile; userEmail: string | null }
  | { status: "local"; reason: "no-user" };

async function syncProfileToSupabase(
  profile: UserProfile,
): Promise<ProfileSyncResult> {
  const { getCurrentUser } = await import("@/lib/supabase/auth");
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    console.warn(
      "Perfil guardado solo en localStorage: no hay usuario autenticado en Supabase Auth.",
    );

    return { status: "local", reason: "no-user" };
  }

  try {
    const { saveProfileToSupabase } = await import("@/lib/supabase/profiles");
    const savedProfile = await saveProfileToSupabase(profile, {
      userId: currentUser.id,
    });

    return {
      status: "remote",
      profile: savedProfile,
      userEmail: currentUser.email ?? null,
    };
  } catch (error: unknown) {
    console.error("No se pudo sincronizar el perfil con Supabase.", {
      userId: currentUser.id,
      profileId: profile.id ?? null,
      error,
    });

    throw error;
  }
}

function dislikedFoodsToText(dislikedFoods: string[]) {
  return dislikedFoods.join(", ");
}

function textToDislikedFoods(value: string) {
  return value
    .split(/,|\n/)
    .map((food) => food.trim())
    .filter(Boolean);
}

function normalizeOtherGoal(value: string | undefined) {
  return value?.trim().slice(0, otherGoalMaxLength) ?? "";
}

function toWeeklyTrainingDays(value: number): WeeklyTrainingDays {
  return Math.min(Math.max(value, 0), 7) as WeeklyTrainingDays;
}

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
      {children}
    </span>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-[1.05rem] font-semibold text-[color:var(--color-foreground)] sm:text-lg">
      {title}
    </h2>
  );
}

const compactInputClass =
  "w-full rounded-[0.85rem] border border-[color:var(--color-border)] bg-white px-3 py-2.5 text-[0.78rem] font-medium text-[color:var(--color-foreground)] outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-surface)]";

const chipBaseClass =
  "inline-flex min-h-8 cursor-pointer items-center justify-center rounded-full border px-2.5 py-1.5 text-center text-[0.78rem] font-semibold leading-tight transition-colors";

function InlineSexControl({
  value,
  onChange,
}: {
  value: Sex;
  onChange: (value: Sex) => void;
}) {
  return (
    <div className="inline-flex min-h-10 w-fit flex-wrap items-center gap-x-3 gap-y-2 rounded-[1rem] border border-[color:var(--color-border)] bg-white px-3 py-2">
      <FieldLabel>Sexo:</FieldLabel>
      {sexOptions.map((option) => (
        <label
          key={option.value}
          className="inline-flex cursor-pointer items-center gap-1.5 text-[0.78rem] font-semibold text-[color:var(--color-foreground)]"
        >
          <span>{option.label}</span>
          <input
            type="radio"
            name="sex"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="h-4 w-4 accent-[color:var(--color-accent)]"
          />
        </label>
      ))}
    </div>
  );
}

function TrainingDaysStepper({
  value,
  onChange,
}: {
  value: WeeklyTrainingDays;
  onChange: (value: WeeklyTrainingDays) => void;
}) {
  const normalizedValue = toWeeklyTrainingDays(value);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-[color:var(--color-border)] bg-white px-3 py-2.5">
      <FieldLabel>Días que entrenas a la semana</FieldLabel>
      <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-surface-muted)] p-1">
        <button
          type="button"
          disabled={normalizedValue === 0}
          onClick={() => onChange(toWeeklyTrainingDays(normalizedValue - 1))}
          aria-label="Reducir días de entrenamiento"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
        >
          -
        </button>
        <span className="min-w-10 text-center text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
          {normalizedValue}
        </span>
        <button
          type="button"
          disabled={normalizedValue === 7}
          onClick={() => onChange(toWeeklyTrainingDays(normalizedValue + 1))}
          aria-label="Aumentar días de entrenamiento"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
        >
          +
        </button>
      </div>
    </div>
  );
}

function HouseholdSizeStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const normalizedValue = Math.min(Math.max(value, 1), 6);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-[color:var(--color-border)] bg-white px-3 py-2.5">
      <FieldLabel>¿Para cuántas personas?</FieldLabel>
      <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-surface-muted)] p-1">
        <button
          type="button"
          disabled={normalizedValue === 1}
          onClick={() => onChange(normalizedValue - 1)}
          aria-label="Reducir personas del menú semanal"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
        >
          -
        </button>
        <span className="min-w-10 text-center text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
          {normalizedValue}
        </span>
        <button
          type="button"
          disabled={normalizedValue === 6}
          onClick={() => onChange(normalizedValue + 1)}
          aria-label="Aumentar personas del menú semanal"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
        >
          +
        </button>
      </div>
    </div>
  );
}

function ChipCheckboxGroup<T extends string>({
  options,
  values,
  onChange,
}: {
  options: { label: string; value: T }[];
  values: T[];
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const isChecked = values.includes(option.value);

        return (
          <label
            key={option.value}
            className={`${chipBaseClass} ${
              isChecked
                ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-foreground)]"
                : "border-[color:var(--color-border)] bg-white text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)]"
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() =>
                onChange(
                  isChecked
                    ? values.filter((value) => value !== option.value)
                    : [...values, option.value],
                )
              }
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [dislikedFoodsText, setDislikedFoodsText] = useState("");
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved-local" | "saved-remote" | "error"
  >("idle");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const dislikedFoodsCharacters = useMemo(
    () => dislikedFoodsText.length,
    [dislikedFoodsText],
  );
  const otherGoalCharacters = useMemo(
    () => profile.otherGoal?.length ?? 0,
    [profile.otherGoal],
  );

  useEffect(() => {
    let isCancelled = false;
    const loadProfile = window.setTimeout(() => {
      void loadInitialProfile();
    }, 0);

    async function loadInitialProfile() {
      const savedProfile = readSavedProfile();

      if (savedProfile) {
        setProfile(savedProfile);
        setDislikedFoodsText(dislikedFoodsToText(savedProfile.dislikedFoods));
        setHasLoadedProfile(true);
        return;
      }

      try {
        const { getLatestProfileFromSupabase } = await import(
          "@/lib/supabase/profiles"
        );
        const latestProfile = await getLatestProfileFromSupabase();

        if (!latestProfile || isCancelled) {
          setHasLoadedProfile(true);
          return;
        }

        const restoredProfile = normalizeProfile(latestProfile);

        setProfile(restoredProfile);
        setDislikedFoodsText(
          dislikedFoodsToText(restoredProfile.dislikedFoods),
        );
        saveProfile(restoredProfile);
      } catch (error: unknown) {
        console.warn(
          "No se pudo recuperar el perfil desde Supabase:",
          error instanceof Error ? error.message : error,
        );
      } finally {
        if (!isCancelled) {
          setHasLoadedProfile(true);
        }
      }
    }

    return () => {
      isCancelled = true;
      window.clearTimeout(loadProfile);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    void import("@/lib/supabase/auth")
      .then(({ getCurrentUser }) => getCurrentUser())
      .then((currentUser) => {
        if (!isCancelled) {
          setUserEmail(currentUser?.email ?? null);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setUserEmail(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const updateProfile = (updates: Partial<UserProfile>) => {
    setProfile((currentProfile) => ({ ...currentProfile, ...updates }));
    setSaveStatus("idle");
  };

  const handleDietaryRestrictionsChange = (
    restrictions: DietaryRestriction[],
  ) => {
    let normalizedRestrictions = restrictions;

    if (
      restrictions.includes("none") &&
      !profile.dietaryRestrictions.includes("none")
    ) {
      normalizedRestrictions = ["none"];
    } else if (restrictions.includes("none") && restrictions.length > 1) {
      normalizedRestrictions = restrictions.filter(
        (restriction) => restriction !== "none",
      );
    } else if (restrictions.length === 0) {
      normalizedRestrictions = ["none"];
    }

    updateProfile({ dietaryRestrictions: normalizedRestrictions });
  };

  const handleGoalsChange = (goals: Goal[]) => {
    const normalizedGoals = Array.from(new Set(goals));

    updateProfile({
      goals: normalizedGoals,
      goal: normalizedGoals[0] ?? "healthy_eating",
      otherGoal: normalizedGoals.includes("other") ? profile.otherGoal : "",
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const profileToSave: UserProfile = {
      ...profile,
      otherTrainingType: profile.trainingTypes.includes("other")
        ? profile.otherTrainingType?.trim()
        : "",
      goals: profile.goals,
      goal: profile.goals[0] ?? "healthy_eating",
      otherGoal: profile.goals.includes("other")
        ? normalizeOtherGoal(profile.otherGoal)
        : "",
      otherAllergies: profile.allergies.includes("other")
        ? profile.otherAllergies?.trim()
        : "",
      dislikedFoods: textToDislikedFoods(dislikedFoodsText),
    };

    saveProfile(profileToSave);
    setProfile(profileToSave);
    setSaveStatus("saving");

    try {
      const syncResult = await syncProfileToSupabase(profileToSave);

      if (syncResult.status === "local") {
        setSaveStatus("saved-local");
        return;
      }

      const profileWithSupabaseIds = {
        ...profileToSave,
        id: syncResult.profile.id,
        userId: syncResult.profile.userId,
        user_id: syncResult.profile.user_id ?? syncResult.profile.userId,
      };

      saveProfile(profileWithSupabaseIds);
      setProfile(profileWithSupabaseIds);
      setUserEmail(syncResult.userEmail);
      setSaveStatus("saved-remote");
    } catch {
      setSaveStatus("error");
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);

    try {
      const { signOut } = await import("@/lib/supabase/auth");
      await signOut();
      setUserEmail(null);
    } catch (error: unknown) {
      console.warn(
        "No se pudo cerrar sesión:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <main
      className={`${pageShellClass} px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-6`}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <section className="sticky top-0 z-30 -mx-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div>
            <p className="ui-eyebrow text-[0.78rem]">Perfil</p>
            <h1 className="mt-2 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
              Tu base nutricional
            </h1>
          </div>
        </section>

        <Card className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div>
            <p className="text-[0.78rem] font-semibold text-[color:var(--color-muted-foreground)]">
              Cuenta
            </p>
            <p className="mt-1 text-sm font-semibold text-[color:var(--color-foreground)]">
              {userEmail ?? "Modo local"}
            </p>
          </div>

          {userEmail ? (
            <PrimaryButton
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="min-h-10 rounded-full px-4 text-xs sm:w-auto"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              Cerrar sesión
            </PrimaryButton>
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-white px-4 text-xs font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
            >
              Entrar o crear cuenta
            </Link>
          )}
        </Card>

        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          <Card className="space-y-3 p-3.5 sm:p-4">
            <SectionTitle title="Datos personales" />
            <div className="space-y-3">
              <InlineSexControl
                value={profile.sex}
                onChange={(sex) => updateProfile({ sex })}
              />

              <label className="flex flex-col gap-2 rounded-[1rem] border border-[color:var(--color-border)] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <FieldLabel>Fecha de nacimiento</FieldLabel>
                <input
                  type="date"
                  required
                  value={profile.birthDate}
                  onChange={(event) =>
                    updateProfile({ birthDate: event.target.value })
                  }
                  className="min-w-0 bg-transparent text-[0.78rem] font-semibold text-[color:var(--color-foreground)] outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <FieldLabel>Altura</FieldLabel>
                  <select
                    value={profile.heightCm}
                    onChange={(event) =>
                      updateProfile({ heightCm: Number(event.target.value) })
                    }
                    className={compactInputClass}
                  >
                    {getNumberOptions(120, 230).map((height) => (
                      <option key={height} value={height}>
                        {height} cm
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5">
                  <FieldLabel>Peso</FieldLabel>
                  <select
                    value={profile.weightKg}
                    onChange={(event) =>
                      updateProfile({ weightKg: Number(event.target.value) })
                    }
                    className={compactInputClass}
                  >
                    {getNumberOptions(45, 200).map((weight) => (
                      <option key={weight} value={weight}>
                        {weight} kg
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </Card>

          <Card className="space-y-3 p-3.5 sm:p-4">
            <SectionTitle title="Actividad" />
            <TrainingDaysStepper
              value={profile.weeklyTrainingDays}
              onChange={(weeklyTrainingDays) =>
                updateProfile({ weeklyTrainingDays })
              }
            />

            <div className="space-y-2">
              <FieldLabel>Tipos de entrenamiento</FieldLabel>
              <ChipCheckboxGroup
                options={trainingTypeOptions}
                values={profile.trainingTypes}
                onChange={(trainingTypes) => updateProfile({ trainingTypes })}
              />
            </div>

            {profile.trainingTypes.includes("other") ? (
              <label className="block space-y-1.5">
                <FieldLabel>Otro entrenamiento</FieldLabel>
                <input
                  type="text"
                  value={profile.otherTrainingType ?? ""}
                  onChange={(event) =>
                    updateProfile({ otherTrainingType: event.target.value })
                  }
                  className={compactInputClass}
                />
              </label>
            ) : null}
          </Card>

          <Card className="space-y-3 p-3.5 sm:p-4">
            <SectionTitle title="Objetivo" />
            <ChipCheckboxGroup
              options={goalOptions}
              values={profile.goals}
              onChange={handleGoalsChange}
            />
            {profile.goals.includes("other") ? (
              <label className="block space-y-1.5">
                <FieldLabel>Cuéntanos tu objetivo</FieldLabel>
                <textarea
                  value={profile.otherGoal ?? ""}
                  maxLength={otherGoalMaxLength}
                  placeholder="Ejemplo: mejorar digestiones, organizar comidas familiares o cuidar energía diaria."
                  onChange={(event) =>
                    updateProfile({
                      otherGoal: event.target.value.slice(
                        0,
                        otherGoalMaxLength,
                      ),
                    })
                  }
                  className={`${compactInputClass} min-h-20 resize-y leading-5 placeholder:text-xs placeholder:italic placeholder:text-[color:var(--color-muted-foreground)]`}
                />
                <span className="block text-right text-[0.68rem] font-semibold text-[color:var(--color-muted-foreground)]">
                  {otherGoalCharacters}/{otherGoalMaxLength}
                </span>
              </label>
            ) : null}
          </Card>

          <Card className="space-y-3 p-3.5 sm:p-4">
            <SectionTitle title="Alimentación" />
            <div className="space-y-3">
              <div className="space-y-1.5">
                <HouseholdSizeStepper
                  value={profile.householdSize}
                  onChange={(householdSize) =>
                    updateProfile({
                      householdSize,
                    })
                  }
                />
                <span className="block whitespace-nowrap text-[0.58rem] leading-none text-[color:var(--color-muted-foreground)]">
                  Esta información se utiliza para calcular las cantidades de las recetas.
                </span>
              </div>

              <div className="space-y-2">
                <FieldLabel>Restricciones alimentarias</FieldLabel>
                <ChipCheckboxGroup
                  options={dietaryRestrictionOptions}
                  values={profile.dietaryRestrictions}
                  onChange={handleDietaryRestrictionsChange}
                />
              </div>

              <div className="space-y-2">
                <FieldLabel>Alergias</FieldLabel>
                <ChipCheckboxGroup
                  options={allergyOptions}
                  values={profile.allergies}
                  onChange={(allergies) => updateProfile({ allergies })}
                />
              </div>

              {profile.allergies.includes("other") ? (
                <label className="block space-y-1.5">
                  <FieldLabel>Otras alergias</FieldLabel>
                  <input
                    type="text"
                    value={profile.otherAllergies ?? ""}
                    onChange={(event) =>
                      updateProfile({ otherAllergies: event.target.value })
                    }
                    className={compactInputClass}
                  />
                </label>
              ) : null}

              <label className="block space-y-1.5">
                <FieldLabel>Alimentos que no te gustan</FieldLabel>
                <textarea
                  value={dislikedFoodsText}
                  maxLength={dislikedFoodsMaxLength}
                  placeholder="Cuéntanos si hay algún alimento que prefieras evitar."
                  onChange={(event) => {
                    setDislikedFoodsText(event.target.value);
                    updateProfile({
                      dislikedFoods: textToDislikedFoods(event.target.value),
                    });
                  }}
                  className={`${compactInputClass} min-h-20 resize-y leading-5 placeholder:text-xs placeholder:italic placeholder:text-[color:var(--color-muted-foreground)]`}
                />
                <span className="block text-right text-[0.68rem] font-semibold text-[color:var(--color-muted-foreground)]">
                  {dislikedFoodsCharacters}/{dislikedFoodsMaxLength}
                </span>
              </label>
            </div>
          </Card>

          <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 -mx-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p
                className={`min-h-5 text-[0.78rem] font-semibold ${
                  saveStatus === "error"
                    ? "text-[color:var(--color-danger)]"
                    : "text-[color:var(--color-secondary-hover)]"
                }`}
              >
                {saveStatus === "saved-remote" ? (
                  <span className="inline-flex items-center gap-2">
                    <Check aria-hidden="true" className="h-4 w-4" />
                    Perfil sincronizado
                  </span>
                ) : saveStatus === "saved-local" ? (
                  <span className="inline-flex items-center gap-2">
                    <Check aria-hidden="true" className="h-4 w-4" />
                    Perfil guardado en este dispositivo
                  </span>
                ) : saveStatus === "saving" ? (
                  "Guardando perfil"
                ) : saveStatus === "error" ? (
                  "Guardado localmente; revisa la consola para Supabase"
                ) : hasLoadedProfile ? (
                  ""
                ) : (
                  "Cargando perfil"
                )}
              </p>
              <PrimaryButton
                type="submit"
                disabled={saveStatus === "saving"}
                className="w-full text-[0.78rem] sm:w-auto"
              >
                <Save aria-hidden="true" className="h-4 w-4" />
                {saveStatus === "saving" ? "Guardando..." : "Guardar perfil"}
              </PrimaryButton>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
