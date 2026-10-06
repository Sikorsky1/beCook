const defaultAfterLoginPath = "/profile";

// Only same-origin paths are accepted, so ?next= cannot redirect off-site.
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return defaultAfterLoginPath;
  }

  try {
    const url = new URL(value, "http://becook.invalid");
    if (url.origin !== "http://becook.invalid") return defaultAfterLoginPath;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return defaultAfterLoginPath;
  }
}

export function loginHrefFor(path: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(path))}`;
}
