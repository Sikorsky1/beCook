export const defaultAfterLoginPath = "/week";
// A new account has no preferences yet: without a destination it starts the onboarding (D2).
export const defaultAfterSignupPath = "/onboarding";

// Account screens are never a destination after signing in: returning to them would loop.
const authRoutePrefixes = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth"];

export function isAuthPath(pathname: string | null | undefined) {
  if (!pathname) return false;
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes are compared as written.
  }
  const normalized = decoded.toLowerCase().replace(/\/+$/, "") || "/";
  return authRoutePrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

// Only same-origin, non-account paths are accepted, so ?next= cannot redirect off-site or loop.
export function safeNextPath(
  value: string | null | undefined,
  fallback: string = defaultAfterLoginPath,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  try {
    const url = new URL(value, "http://becook.invalid");
    if (url.origin !== "http://becook.invalid") return fallback;
    if (isAuthPath(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function loginHrefFor(path: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(path))}`;
}

type AuthRoute = "/login" | "/signup" | "/forgot-password" | "/reset-password" | "/auth/callback";

// Links between account screens keep the requested destination; an unusable one is dropped.
export function authHref(route: AuthRoute, next: string | null | undefined) {
  const destination = safeNextPath(next, "");
  return destination ? `${route}?next=${encodeURIComponent(destination)}` : route;
}

// Absolute address for links sent by email (confirmation and password recovery).
export function authRedirectUrl(origin: string, route: AuthRoute, next: string | null | undefined) {
  return `${origin.replace(/\/+$/, "")}${authHref(route, next)}`;
}

// --- Bottom navigation (step 32) -------------------------------------------------------------
// Three destinations. «Crear menú» is an action on a week, not a destination: its route stays and
// marks Semana. Routes are matched by segment, so /week marks /week/x but not /weekly.

export type AppSectionId = "week" | "shopping" | "profile";

export type AppSection = {
  id: AppSectionId;
  href: string;
  label: string;
  // Path prefixes (whole segments) that belong to this section.
  prefixes: readonly string[];
};

export const appSections: readonly AppSection[] = [
  { id: "week", href: "/week", label: "Semana", prefixes: ["/week", "/create-menu", "/import"] },
  { id: "shopping", href: "/shopping/list", label: "Compra", prefixes: ["/shopping", "/shopping-list", "/pantry"] },
  { id: "profile", href: "/profile", label: "Perfil", prefixes: ["/profile"] },
];

function normalizePath(pathname: string) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes are compared as written.
  }
  const path = decoded.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, "");
  return path || "/";
}

const underPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

// The section a route belongs to; null for routes outside the three (e.g. /onboarding).
export function activeSection(pathname: string | null | undefined): AppSectionId | null {
  if (!pathname) return null;
  const path = normalizePath(pathname);
  if (path === "/") return "week";
  if (isAuthPath(path)) return "profile";
  return appSections.find((section) => section.prefixes.some((prefix) => underPrefix(path, prefix)))?.id ?? null;
}

// «page» only on the destination itself; «true» on the routes under it (Crear menú, Despensa,
// login…), so a screen reader says «actual» without claiming the link points to this page.
export function sectionAriaCurrent(section: AppSection, pathname: string | null | undefined): "page" | "true" | undefined {
  if (activeSection(pathname) !== section.id) return undefined;
  return normalizePath(pathname ?? "") === section.href ? "page" : "true";
}

// Crear menú opened on the import form (contract with C6: ?mode=import), for a week if it is valid.
export function createMenuImportHref(week?: string | string[] | null) {
  const value = Array.isArray(week) ? week[0] : week;
  return value && /^\d{4}-W\d{2}$/.test(value)
    ? `/create-menu?mode=import&week=${value}`
    : "/create-menu?mode=import";
}
