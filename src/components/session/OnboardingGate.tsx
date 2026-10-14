"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useIdentity } from "@/components/session/IdentityProvider";
import {
  activeOnboardingSteps,
  isOnboardingDismissed,
  isOnboardingSettled,
  markOnboardingSettled,
  onboardingPath,
  onboardingStatus,
  weekOnboardingAction,
  type ActiveOnboardingStep,
} from "@/lib/onboarding";
import { getOnboardingAccount } from "@/lib/supabase/onboarding";

// /week: a new account (or one with the onboarding half done) goes to the onboarding; after
// «Ahora no» it is offered here instead. Accounts from before the onboarding see nothing.
export function OnboardingGate() {
  const router = useRouter();
  const identity = useIdentity();
  const [offer, setOffer] = useState<ActiveOnboardingStep | null>(null);

  useEffect(() => {
    const userId = identity.userId;

    if (identity.status !== "ready" || !userId || isOnboardingSettled(userId)) {
      return;
    }

    let isCancelled = false;

    void getOnboardingAccount(userId).then(
      (account) => {
        if (isCancelled) return;
        const status = onboardingStatus(account);
        const action = weekOnboardingAction(status, isOnboardingDismissed(userId));

        if (action.kind === "none") {
          markOnboardingSettled(userId);
        } else if (action.kind === "redirect") {
          router.replace(onboardingPath);
        } else {
          setOffer(action.step);
        }
      },
      // Unknown state (offline): the week works as usual.
      () => undefined,
    );

    return () => {
      isCancelled = true;
      setOffer(null);
    };
  }, [identity.status, identity.userId, identity.epoch, router]);

  if (!offer) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm leading-6 text-[color:var(--color-foreground)]">
        Te queda configurar beCook (paso {activeOnboardingSteps.indexOf(offer) + 1} de {activeOnboardingSteps.length}).
        Lo que ya guardaste sigue en tu cuenta.
      </p>
      <Link
        href={onboardingPath}
        aria-label="Continuar la configuración de beCook"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[color:var(--color-accent-strong)] bg-[image:var(--accent-gradient)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--color-accent-strong-hover)] hover:bg-[image:var(--accent-gradient-hover)]"
      >
        Continuar
      </Link>
    </div>
  );
}
