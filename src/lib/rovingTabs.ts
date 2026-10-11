// Keyboard model of a tab list with roving tabindex (WAI-ARIA Authoring Practices, «Tabs»):
// ←/→ move to the previous/next tab and wrap around, Inicio/Fin go to the first/last one.
// Returns the index of the tab that should receive focus (and be selected, since activation is
// automatic), or null when the key is not part of the pattern and must keep its default action.
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;

  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// Stable ids that link each tab with its panel (aria-controls / aria-labelledby).
export function tabIds(prefix: string, value: string) {
  return { tab: `${prefix}-tab-${value}`, panel: `${prefix}-panel-${value}` };
}
