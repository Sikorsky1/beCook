import type { Metadata } from "next";

import { LegalPage } from "@/lib/legal/markdown";

export const metadata: Metadata = {
  title: "Política de privacidad · beCook",
  description: "Qué datos trata beCook, para qué, con quién y durante cuánto tiempo.",
};

export default function PrivacyPage() {
  return <LegalPage file="privacidad.md" related={{ href: "/condiciones", label: "Condiciones de uso" }} />;
}
