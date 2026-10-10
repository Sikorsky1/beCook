"use client";

import { ArrowLeft, Check, ShoppingBasket, Sparkles, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { GoalsField, HouseholdField, RestrictionsFields } from "@/components/features/ProfileFields";
import { useIdentity } from "@/components/session/IdentityProvider";
import { SyncStatus } from "@/components/session/SyncStatus";
import { Button, PrimaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateMessage } from "@/components/ui/StateMessage";
import { addPantryItem, loadPantry, readPantryView, setPantryItemActive } from "@/lib/data/pantry";
import { loadProfile, readCachedProfile, saveProfile } from "@/lib/data/repositories";
import { authHref } from "@/lib/navigation";
import {
  activeOnboardingSteps,
  dismissOnboarding,
  expressPantryItems,
  markOnboardingSettled,
  onboardingFinishPath,
  onboardingPath,
  onboardingStatus,
  type ActiveOnboardingStep,
  type OnboardingStatus,
} from "@/lib/onboarding";
import { pantryItemKey, type PantryStorageItem } from "@/lib/pantryStorage";
import {
  buildOnboardingProfile,
  draftFromProfile,
  emptyProfileDraft,
  menuSections,
  profileSectionInfo,
  readStoredProfile,
  type ProfileDraft,
} from "@/lib/profileForm";
import { advanceOnboarding, getOnboardingAccount } from "@/lib/supabase/onboarding";
import type { ProfileValidationIssue, UserProfile } from "@/lib/supabase/profiles";
import { pageShellClass } from "@/lib/ui";

type LoadState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "error" }
  | { status: "ready"; onboarding: OnboardingStatus };

type StepError = { message: string } | null;

const stepTitles: Record<ActiveOnboardingStep, string> = {
  about: "Qué es beCook",
  profile: "Tu casa y tu comida",
  pantry: "Despensa exprés",
};

function StepProgress({ step }: { step: ActiveOnboardingStep }) {
  const index = activeOnboardingSteps.indexOf(step);

  return (
    <div>
      <p className="t-eyebrow">
        Paso {index + 1} de {activeOnboardingSteps.length} · {stepTitles[step]}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
        {activeOnboardingSteps.map((item, itemIndex) => (
          <span
            key={item}
            className={`h-1.5 rounded-full ${
              itemIndex <= index ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-border)]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorText({ error }: { error: StepError }) {
  return error ? (
    <p role="alert" className="text-[0.78rem] font-semibold text-[color:var(--color-danger)]">
      {error.message}
    </p>
  ) : null;
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="t-body-strong text-[color:var(--color-foreground)]">{title}</p>
        <p className="t-meta mt-0.5">{children}</p>
      </div>
    </li>
  );
}

function AboutContent() {
  return (
    <ul className="space-y-4">
      <Feature icon={<Sparkles className="h-5 w-5" />} title="Tu menú de la semana">
        Te propone comidas y cenas para siete días según para cuántos cocinas, tu objetivo y lo que no
        puedes o no quieres comer. Tú decides si lo usas.
      </Feature>
      <Feature icon={<ShoppingBasket className="h-5 w-5" />} title="La compra, hecha">
        Con el menú sale la lista de la compra, sin lo que ya tienes en la despensa.
      </Feature>
      <Feature icon={<UsersRound className="h-5 w-5" />} title="En todos tus dispositivos">
        Todo se guarda en tu cuenta: puedes seguir en el móvil lo que empezaste en el ordenador.
      </Feature>
    </ul>
  );
}

const firstIssues = (issues: ProfileValidationIssue[]) =>
  Array.from(new Set(issues.map((issue) => issue.message))).join(" ");

export default function OnboardingPage() {
  const router = useRouter();
  const identity = useIdentity();
  const dataIdentity = { scope: identity.scope, userId: identity.userId };
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [step, setStep] = useState<ActiveOnboardingStep>("about");
  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [pantry, setPantry] = useState<PantryStorageItem[]>([]);
  const [pantryNotice, setPantryNotice] = useState<string | null>(null);
  // B5 save state of the express pantry, as in Despensa. «Reintentar» reads the pantry again,
  // which first sends the changes pending on this device.
  const [pantrySync, setPantrySync] = useState<{ offline?: boolean; pending?: boolean }>({});
  const [isCheckingPantry, setIsCheckingPantry] = useState(true);
  const [savingPantry, setSavingPantry] = useState(0);
  const [pantryReload, setPantryReload] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StepError>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const userId = identity.userId;
    const current = { scope: identity.scope, userId };

    const timer = window.setTimeout(() => {
      setError(null);

      if (!userId) {
        setLoad({ status: "guest" });
        return;
      }

      setLoad({ status: "loading" });
      const cached = readStoredProfile(readCachedProfile(current));
      setSavedProfile(cached);
      setDraft(draftFromProfile(cached));

      void Promise.all([getOnboardingAccount(userId), loadProfile(current)]).then(
        async ([account, profileResult]) => {
          if (isCancelled) return;
          const profile = readStoredProfile(profileResult.data);
          setSavedProfile(profile);
          setDraft(draftFromProfile(profile));
          let onboarding = onboardingStatus(account);

          if (onboarding.kind === "active" && onboarding.isNew) {
            // A new account: the progress row marks it as one being set up, on every device.
            try {
              await advanceOnboarding("about");
            } catch {
              if (!isCancelled) setLoad({ status: "error" });
              return;
            }
            onboarding = { ...onboarding, isNew: false };
          }

          if (isCancelled) return;
          if (onboarding.kind === "active") {
            setStep(onboarding.step);
          }
          setLoad({ status: "ready", onboarding });
        },
        () => {
          if (!isCancelled) setLoad({ status: "error" });
        },
      );
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch, reloadKey]);

  useEffect(() => {
    if (step !== "pantry" || !identity.userId) {
      return;
    }

    let isCancelled = false;
    const current = { scope: identity.scope, userId: identity.userId };
    const timer = window.setTimeout(() => {
      setPantry(readPantryView(current));
      setIsCheckingPantry(true);
      void loadPantry(current).then((result) => {
        if (isCancelled) return;
        setPantry(readPantryView(current));
        setPantrySync({ offline: result.offline, pending: result.pending });
        setIsCheckingPantry(false);
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, identity.scope, identity.userId, pantryReload]);

  // Moves the account forward (finishing goes to Crear menú).
  const goTo = async (next: ActiveOnboardingStep | "done") => {
    setIsBusy(true);
    setError(null);

    try {
      const progress = await advanceOnboarding(next);
      if (next === "done" || progress.step === "done") {
        if (identity.userId) markOnboardingSettled(identity.userId);
        router.push(onboardingFinishPath);
        return;
      }
      // The account never goes back; going forward from a step reviewed again shows the next one.
      setStep(next);
    } catch {
      setError({ message: "No se ha podido guardar tu avance. Comprueba la conexión y vuelve a intentarlo." });
    } finally {
      setIsBusy(false);
    }
  };

  const saveProfileStep = async () => {
    const built = buildOnboardingProfile(savedProfile, draft);

    if (!built.ok) {
      setError({ message: firstIssues(built.issues) });
      return;
    }

    setIsBusy(true);
    setError(null);
    const result = await saveProfile(dataIdentity, built.profile);
    setIsBusy(false);

    if (result.status === "conflict") {
      const remote = readStoredProfile(result.remoteData);
      setSavedProfile(remote);
      setDraft(draftFromProfile(remote));
      setError({ message: "Tu cuenta tenía cambios de otro dispositivo: se muestran. Revísalos y vuelve a guardar." });
      return;
    }

    if (result.status !== "synced") {
      // Kept on this device, but another device would not find it: do not move on yet.
      setSavedProfile(built.profile);
      setError({ message: "No se ha podido guardar en tu cuenta. Comprueba la conexión y vuelve a intentarlo." });
      return;
    }

    setSavedProfile(built.profile);
    setDraft(draftFromProfile(built.profile));
    await goTo("pantry");
  };

  const togglePantryItem = async (name: string, category: PantryStorageItem["category"]) => {
    const key = pantryItemKey({ name, category });
    const current = pantry.find((item) => pantryItemKey(item) === key);
    setPantryNotice(null);
    setSavingPantry((count) => count + 1);
    const result = current
      ? await setPantryItemActive(dataIdentity, category, current.name, !current.active)
      : await addPantryItem(dataIdentity, category, name);
    setSavingPantry((count) => count - 1);
    setPantry(result.items);
    setPantrySync(result.status === "pending" ? { pending: true } : {});

    if (result.status === "conflict") {
      setPantryNotice("Tu despensa había cambiado en otro dispositivo: se muestra como está en tu cuenta.");
    }
  };

  const leave = () => {
    if (identity.userId) {
      dismissOnboarding(identity.userId);
    }
    router.push("/week");
  };

  const shell = (children: ReactNode) => (
    <main className={`${pageShellClass} px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-8`}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">{children}</div>
    </main>
  );

  if (load.status === "loading") {
    return shell(<StateMessage title="Preparando beCook" variant="loading" />);
  }

  if (load.status === "error") {
    return shell(
      <StateMessage
        title="No se ha podido cargar tu cuenta"
        variant="error"
        action={
          <Button type="button" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Reintentar
          </Button>
        }
      >
        <p>Comprueba la conexión. Lo que ya guardaste sigue en tu cuenta.</p>
      </StateMessage>,
    );
  }

  if (load.status === "guest") {
    return shell(
      <Card className="space-y-5 p-4 sm:p-6">
        <h1 className="t-h1 text-[color:var(--color-foreground)]">Bienvenido a beCook</h1>
        <AboutContent />
        <p className="t-meta">Crea una cuenta para guardar tu perfil y tus menús y seguir en cualquier dispositivo.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={authHref("/signup", onboardingPath)}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-[color:var(--color-accent)] px-4 text-sm font-semibold text-white"
          >
            Crear cuenta
          </Link>
          <Link
            href={authHref("/login", onboardingPath)}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
          >
            Ya tengo cuenta
          </Link>
        </div>
        <Link href="/profile" className="t-meta block text-center underline">
          Seguir sin cuenta
        </Link>
      </Card>,
    );
  }

  if (load.onboarding.kind !== "active") {
    const isExisting = load.onboarding.kind === "existing";

    return shell(
      <Card className="space-y-4 p-4 sm:p-6">
        <h1 className="t-h1 text-[color:var(--color-foreground)]">
          {isExisting ? "Tu cuenta ya está en marcha" : "Ya has configurado beCook"}
        </h1>
        <p className="t-meta">
          {isExisting
            ? "Tu cuenta ya tiene perfil o menús guardados, así que no hace falta empezar de cero. Revisa tu perfil cuando quieras."
            : "Tu perfil está guardado. Puedes cambiarlo en Perfil o crear un menú nuevo."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/create-menu"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-[color:var(--color-accent)] px-4 text-sm font-semibold text-white"
          >
            Crear menú
          </Link>
          <Link
            href="/profile"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
          >
            Revisar perfil
          </Link>
        </div>
      </Card>,
    );
  }

  const selectedPantry = new Set(pantry.filter((item) => item.active).map(pantryItemKey));

  return shell(
    <>
      <StepProgress step={step} />

      {step === "about" ? (
        <Card className="space-y-5 p-4 sm:p-6">
          <h1 className="t-h1 text-[color:var(--color-foreground)]">Bienvenido a beCook</h1>
          <AboutContent />
          <p className="t-meta">Son tres pasos y menos de dos minutos. Lo que guardes se conserva aunque lo dejes a medias.</p>
          <ErrorText error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="soft" onClick={leave} className="rounded-full">
              Ahora no
            </Button>
            <PrimaryButton type="button" size="lg" disabled={isBusy} onClick={() => void goTo("profile")}>
              Empezar
            </PrimaryButton>
          </div>
        </Card>
      ) : null}

      {step === "profile" ? (
        <>
          <div>
            <h1 className="t-h1 text-[color:var(--color-foreground)]">Para quién cocinas y qué necesitas</h1>
            <p className="t-meta mt-1">
              Es lo que tu menú tiene en cuenta. Nada está marcado: elige tus respuestas, también «Ninguna» si es el caso.
            </p>
          </div>
          {menuSections.map((section) => (
            <Card key={section} className="space-y-3 p-3.5 sm:p-4">
              <h2 className="t-h2 text-[color:var(--color-foreground)]">{profileSectionInfo[section].title}</h2>
              <p className="t-meta">{profileSectionInfo[section].usage}</p>
              {section === "household" ? (
                <HouseholdField draft={draft} onChange={(updates) => setDraft((current) => ({ ...current, ...updates }))} />
              ) : section === "goals" ? (
                <GoalsField draft={draft} onChange={(updates) => setDraft((current) => ({ ...current, ...updates }))} />
              ) : (
                <RestrictionsFields
                  draft={draft}
                  onChange={(updates) => setDraft((current) => ({ ...current, ...updates }))}
                />
              )}
            </Card>
          ))}
          <p className="t-meta">El entrenamiento y los datos corporales son opcionales; puedes añadirlos luego en Perfil.</p>
          <ErrorText error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="soft" onClick={() => setStep("about")} className="rounded-full">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Atrás
            </Button>
            <PrimaryButton type="button" size="lg" disabled={isBusy} onClick={() => void saveProfileStep()}>
              {isBusy ? "Guardando…" : "Guardar y continuar"}
            </PrimaryButton>
          </div>
        </>
      ) : null}

      {step === "pantry" ? (
        <Card className="space-y-4 p-4 sm:p-6">
          <div>
            <h1 className="t-h1 text-[color:var(--color-foreground)]">¿Qué tienes ya en casa?</h1>
            <p className="t-meta mt-1">
              Opcional. Marca lo que tengas y no saldrá en tu lista de la compra. Cada cambio se guarda al momento y
              luego puedes completarlo en Despensa.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Despensa exprés">
            {expressPantryItems.map((item) => {
              const checked = selectedPantry.has(pantryItemKey(item));

              return (
                <button
                  key={pantryItemKey(item)}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => void togglePantryItem(item.name, item.category)}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.78rem] font-semibold ${
                    checked
                      ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] text-[color:var(--color-foreground)]"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)]"
                  }`}
                >
                  {checked ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                  {item.name}
                </button>
              );
            })}
          </div>
          <SyncStatus
            signedIn={identity.userId !== null}
            saving={savingPantry > 0}
            checking={isCheckingPantry}
            offline={pantrySync.offline}
            pending={pantrySync.pending}
            onRetry={() => setPantryReload((count) => count + 1)}
          />
          {pantryNotice ? <p role="status" className="t-meta text-[color:var(--color-accent)]">{pantryNotice}</p> : null}
          <ErrorText error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="soft" onClick={() => setStep("profile")} className="rounded-full">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Atrás
            </Button>
            <PrimaryButton type="button" size="lg" disabled={isBusy} onClick={() => void goTo("done")}>
              {selectedPantry.size > 0 ? "Terminar y crear mi menú" : "Saltar y crear mi menú"}
            </PrimaryButton>
          </div>
        </Card>
      ) : null}
    </>,
  );
}
