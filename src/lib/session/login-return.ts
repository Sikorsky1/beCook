// Going to /login must not lose what the user was writing: screens with unsent input
// register a saver, and every "Iniciar sesión" entry point runs them before navigating.
import { isAuthPath, loginHrefFor, safeNextPath } from "@/lib/navigation";

const savers = new Set<() => void>();

export function registerBeforeLoginSaver(save: () => void) {
  savers.add(save);
  return () => {
    savers.delete(save);
  };
}

export function runBeforeLoginSavers() {
  savers.forEach((save) => {
    try {
      save();
    } catch {
      // A failing saver must not block the others or the navigation.
    }
  });
}

// Current page with its query (e.g. ?week=), so the user comes back to the same week.
export function currentReturnPath(location: Pick<Location, "pathname" | "search"> = window.location) {
  if (isAuthPath(location.pathname)) return null;
  return safeNextPath(`${location.pathname}${location.search}`);
}

export function loginHrefForCurrentPage(location?: Pick<Location, "pathname" | "search">) {
  return loginHrefFor(currentReturnPath(location) ?? "/week");
}
