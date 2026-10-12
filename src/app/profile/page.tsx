"use client";

import { Check, ChevronDown, LogIn, LogOut, Save } from "lucide-react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  ChoiceChips,
  FieldLabel,
  GoalsField,
  HouseholdField,
  RestrictionsFields,
  compactInputClass,
  goalOptions,
} from "@/components/features/ProfileFields";
import { StickyPageHeader } from "@/components/layout/StickyPageHeader";
import { useIdentity, useIdentityActions } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { SyncStatus } from "@/components/session/SyncStatus";
import { Button, PrimaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { enabledOAuthProviders, oauthProviderLabels } from "@/lib/auth/account";
import { loadProfile, readCachedProfile, saveProfile } from "@/lib/data/repositories";
import { loginHrefFor } from "@/lib/navigation";
import {
  applySection,
  buildNewProfile,
  canSaveSection,
  draftFromProfile,
  emptyBodyDraft,
  emptyProfileDraft,
  issuesBySection,
  profileSectionInfo,
  profileSections,
  readStoredProfile,
  resetSections,
  sectionStatus,
  type ProfileDraft,
  type ProfileSection,
  type SectionStatus,
} from "@/lib/profileForm";
import { scopeHasPendingChanges } from "@/lib/storage/scoped-storage";
import {
  PROFILE_LIMITS,
  type ProfileValidationIssue,
  type Sex,
  type TrainingType,
  type UserProfile,
  type WeeklyTrainingDays,
} from "@/lib/supabase/profiles";
import { pageBleedClass, pageShellStickyClass, pageStickyColumnClass } from "@/lib/ui";

// Inlined at build time, as in OAuthButtons: «con Google o con tu email» where Google is enabled.
const signInWays = [
  ...enabledOAuthProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS).map((provider) => `con ${oauthProviderLabels[provider]}`),
  "con tu email",
].join(" o ");

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

const statusLabels: Record<SectionStatus, string> = {
  pending: "Pendiente",
  unsaved: "Sin guardar",
  saved: "Guardado",
  assumed: "Asumido",
  optional: "Opcional",
};

function toWeeklyTrainingDays(value: number): WeeklyTrainingDays {
  const { min, max } = PROFILE_LIMITS.weeklyTrainingDays;

  return Math.min(Math.max(value, min), max) as WeeklyTrainingDays;
}

function StatusBadge({ status }: { status: SectionStatus }) {
  const tone =
    status === "saved"
      ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-secondary-hover)]"
      : status === "unsaved" || status === "assumed"
        ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
        : "border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)]";

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
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
      <div role="alert" className="space-y-1 text-sm font-semibold text-[color:var(--color-danger)]">
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
      className={`inline-flex items-center gap-2 text-sm font-semibold ${
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
      {status === "assumed" ? (
        <p className="t-meta text-[color:var(--color-accent)]">
          Esto se guardó con el formulario anterior, que rellenaba algunas respuestas solo. Revísalo y pulsa Confirmar.
        </p>
      ) : null}
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
  const isSignedOut = identity.status === "ready" && identity.userId === null;
  const [syncState, setSyncState] = useState<SyncState>({});
  const [isSigningOut, setIsSigningOut] = useState(false);
  // B5: «Reintentar» reads the profile again, which resends a change pending on this device.
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const isSaving = Object.values(saveStates).some((state) => state?.status === "saving");
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
  const assumedSections = profileSections.filter((section) => statuses[section] === "assumed");

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

  // Only the save state changes; edits not saved yet stay in the form. If the account had a newer
  // profile, the sections without such edits show it (as after a conflict).
  const retrySync = async () => {
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    setIsRetryingSync(true);
    const result = await loadProfile(dataIdentity);
    setIsRetryingSync(false);
    setSyncState({
      offline: result.offline,
      discardedLocalChanges: result.discardedLocalChanges,
      pending: result.pending,
    });

    if (result.discardedLocalChanges) {
      const remoteProfile = readStoredProfile(result.data);
      const untouched = profileSections.filter((section) => statuses[section] !== "unsaved");
      setSavedProfile(remoteProfile);
      setDraft((current) => resetSections(current, remoteProfile, untouched));
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
    const isAssumed = statuses[section] === "assumed";
    const canSave = canSaveSection(statuses[section]) && !isSaving;

    return (
      <div className="flex flex-col gap-2 border-t border-[color:var(--color-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5">
          <SectionFeedback state={state} />
        </div>
        <Button
          type="button"
          variant={canSaveSection(statuses[section]) ? "primary" : "soft"}
          disabled={!canSave}
          onClick={() => void save(section)}
          className="w-full rounded-full sm:w-auto"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {state?.status === "saving" ? "Guardando…" : isAssumed ? "Confirmar" : "Guardar"}
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
    <main className={pageShellStickyClass}>
      <div className={pageStickyColumnClass}>
        <StickyPageHeader title="Perfil" heading="Lo que necesita tu menú" />

        <Card className="space-y-3 p-3.5 sm:p-4">
          {isSignedOut ? (
            <div className="space-y-3">
              <h2 className="t-h2 text-[color:var(--color-foreground)]">Guarda tu perfil en una cuenta</h2>
              <p className="t-meta">
                Ahora solo se guarda en este dispositivo. Entra {signInWays} y tendrás tu perfil y tus menús en
                cualquier dispositivo.
              </p>
              <PrimaryButton asChild size="lg" className="w-full sm:w-auto">
                <Link href={loginHrefFor("/profile")}>
                  <LogIn aria-hidden="true" className="h-4 w-4" />
                  Entrar o crear cuenta
                </Link>
              </PrimaryButton>
            </div>
          ) : userEmail ? (
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-soft)] text-lg font-semibold text-[color:var(--color-accent)]"
              >
                {userEmail[0].toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="t-body-strong truncate text-[color:var(--color-foreground)]">{userEmail}</p>
                <p className="t-meta mt-0.5">
                  {householdSummary ? `${goalSummary} · ${householdSummary}` : goalSummary}
                </p>
              </div>
            </div>
          ) : null}
          {hasLoadedProfile && pendingSections.length > 0 ? (
            <p className="t-meta">
              <span className="font-semibold text-[color:var(--color-foreground)]">Falta por completar:</span>{" "}
              {pendingSections.map((section) => profileSectionInfo[section].title.replace(/^¿|\?$/g, "")).join(" · ")}
            </p>
          ) : null}
          {hasLoadedProfile && assumedSections.length > 0 ? (
            <p className="t-meta">
              <span className="font-semibold text-[color:var(--color-foreground)]">Por confirmar:</span>{" "}
              {assumedSections.map((section) => profileSectionInfo[section].title.replace(/^¿|\?$/g, "")).join(" · ")}
            </p>
          ) : null}
          {!hasLoadedProfile ? <p className="t-meta">Cargando perfil</p> : null}
          {savedProfile || syncState.offline || syncState.pending ? (
            <SyncStatus
              signedIn={identity.userId !== null}
              saving={isSaving || isRetryingSync}
              checking={!hasLoadedProfile}
              offline={syncState.offline}
              pending={syncState.pending}
              onRetry={() => void retrySync()}
            />
          ) : null}
          {/* The bottom bar goes away after the first save; its result stays visible here. */}
          {savedProfile ? <SectionFeedback state={saveStates.all} /> : null}
        </Card>

        <form onSubmit={handleCreate} className="space-y-3 sm:space-y-4" noValidate>
          <SectionCard section="household" status={statuses.household} footer={sectionFooter("household")}>
            <HouseholdField draft={draft} onChange={(updates) => updateDraft("household", updates)} />
          </SectionCard>

          <SectionCard section="goals" status={statuses.goals} footer={sectionFooter("goals")}>
            <GoalsField draft={draft} onChange={(updates) => updateDraft("goals", updates)} />
          </SectionCard>

          <SectionCard section="restrictions" status={statuses.restrictions} footer={sectionFooter("restrictions")}>
            <RestrictionsFields draft={draft} onChange={(updates) => updateDraft("restrictions", updates)} />
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
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-base font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  -
                </button>
                <span aria-live="polite" className="t-body-strong min-w-10 text-center text-[color:var(--color-foreground)]">
                  {draft.weeklyTrainingDays}
                  <span className="sr-only"> {draft.weeklyTrainingDays === 1 ? "día" : "días"}</span>
                </span>
                <button
                  type="button"
                  disabled={draft.weeklyTrainingDays === 7}
                  onClick={() =>
                    updateDraft("training", { weeklyTrainingDays: toWeeklyTrainingDays(draft.weeklyTrainingDays + 1) })
                  }
                  aria-label="Aumentar días de entrenamiento"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-base font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
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
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm font-semibold text-[color:var(--color-foreground)]"
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
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-[color:var(--color-muted-foreground)]">
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
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-[color:var(--color-muted-foreground)]">
                        kg
                      </span>
                    </span>
                  </label>
                </div>

                {draft.sex || draft.birthDate || draft.heightCm.trim() || draft.weightKg.trim() ? (
                  <Button
                    type="button"
                    variant="soft"
                    onClick={() => updateDraft("body", emptyBodyDraft())}
                    className="rounded-full"
                  >
                    Borrar datos corporales
                  </Button>
                ) : null}
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
            {/* Signed out, entering or creating an account is the first card of the page. */}
            {userEmail ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="t-meta min-w-0 truncate">{userEmail}</p>
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
              </div>
            ) : null}
            <Link href="/profile/data" className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-foreground)] underline underline-offset-4 hover:text-[color:var(--color-accent-hover)]">Tus datos: descargar o eliminar la cuenta</Link>
          </Card>

          {!savedProfile && hasLoadedProfile ? (
            <div data-profile-save-bar className={`sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 py-3 backdrop-blur ${pageBleedClass}`}>
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
