export const defaultAfterLoginPath = "/week";
// A new account has no preferences yet: without a destination it starts in Perfil.
export const defaultAfterSignupPath = "/profile";

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
