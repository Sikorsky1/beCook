import type { Metadata } from "next";

import { LegalPage } from "@/lib/legal/markdown";

// Public home page for Google's consent screen: what beCook is, what signing in with Google asks
// for and why, and the legal texts. Read from docs/legal at build time only; no session needed.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Qué es beCook",
  description:
    "beCook planifica tu menú semanal, la lista de la compra y la despensa. Qué datos pide al entrar con Google y para qué.",
};

export default function AboutPage() {
  return (
    <LegalPage
      file="sobre.md"
      related={[
        { href: "/privacidad", label: "Política de privacidad" },
        { href: "/condiciones", label: "Condiciones de uso" },
      ]}
    />
  );
}
