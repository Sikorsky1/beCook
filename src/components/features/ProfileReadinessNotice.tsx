import Link from "next/link";

import { assumedMenuSections, profileSectionInfo } from "@/lib/profileForm";
import type { UserProfile } from "@/lib/supabase/profiles";

// Crear menú: what the menu will use from the profile. After the onboarding it explains that the
// first proposal is generated and confirmed here; a profile of the previous form asks for review.
export function ProfileReadinessNotice({
  profile,
  fromOnboarding,
}: {
  profile: UserProfile | null;
  fromOnboarding: boolean;
}) {
  if (!profile) {
    return null;
  }

  const assumed = assumedMenuSections(profile);

  if (fromOnboarding && assumed.length === 0) {
    return (
      <p
        role="status"
        className="mt-3 rounded-[var(--radius-control)] border border-[color:var(--color-secondary)] bg-[color:var(--color-secondary-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--color-foreground)]"
      >
        Tu perfil ya está guardado. Pulsa «Crear menú semanal» para ver tu primera propuesta: no
        cambia tu semana hasta que la revises y pulses «Usar este menú».
      </p>
    );
  }

  if (assumed.length === 0) {
    return null;
  }

  return (
    <p
      role="status"
      className="mt-3 rounded-[var(--radius-control)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--color-warning-foreground)]"
    >
      Tu perfil tiene respuestas sin confirmar (
      {assumed.map((section) => profileSectionInfo[section].title.replace(/^¿|\?$/g, "")).join(" · ")}
      ). El menú las usará tal como están.{" "}
      <Link href="/profile" className="font-semibold underline">
        Revisar perfil
      </Link>
    </p>
  );
}
