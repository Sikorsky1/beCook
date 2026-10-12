import type { Metadata } from "next";

import { LegalPage } from "@/lib/legal/markdown";

// Read from docs/legal at build time only.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Condiciones de uso · beCook",
  description: "Condiciones para usar beCook durante la beta.",
};

export default function TermsPage() {
  return <LegalPage file="condiciones.md" related={{ href: "/privacidad", label: "Política de privacidad" }} />;
}
