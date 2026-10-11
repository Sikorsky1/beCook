import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { BottomNavigation } from "@/components/layout/BottomNavigation";
import { IdentityProvider } from "@/components/session/IdentityProvider";
import { SessionNotices } from "@/components/session/SessionNotices";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
  themeColor: "#fff6ed",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
