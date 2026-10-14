import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import { BottomNavigation } from "@/components/layout/BottomNavigation";
import { IdentityProvider } from "@/components/session/IdentityProvider";
import { SessionNotices } from "@/components/session/SessionNotices";

import "./globals.css";

// Marigold: Inter as the interface typeface.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "beCook",
  description: "Planifica tu menu semanal de forma simple.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

// viewport-fit=cover makes iOS Safari report the real env(safe-area-inset-*) values used by the
// page shell, the bottom navigation and the proposal bar (0 otherwise). Zoom stays allowed.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fcfaf7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      // Step 34 (WCAG 2.4.11): what gets focus or is scrolled to (section links, days) never lands
      // under the fixed header bar (113 px) or the bottom navigation (96 px + air), nor under the
      // proposal bar of Crear menú or the «Guardar perfil» bar of Perfil when they are shown.
      className={`${inter.variable} ${geistMono.variable} h-full antialiased scroll-pb-[calc(6.5rem+env(safe-area-inset-bottom))] has-[[data-sticky-header]]:scroll-pt-[calc(7.5rem+env(safe-area-inset-top))] has-[[data-proposal-bar]]:scroll-pb-[calc(15rem+env(safe-area-inset-bottom))] has-[[data-profile-save-bar]]:scroll-pb-[calc(14rem+env(safe-area-inset-bottom))]`}
    >
      <body className="min-h-full flex flex-col bg-[color:var(--color-background)] text-[color:var(--color-foreground)]">
        <IdentityProvider>
          <SessionNotices />
          {children}
          <BottomNavigation />
        </IdentityProvider>
      </body>
    </html>
  );
}
