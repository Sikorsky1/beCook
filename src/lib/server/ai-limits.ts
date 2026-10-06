// Request limits for the paid AI routes, sized from real payloads (A3).
export const aiRequestLimits = {
  generateMenu: { maxBytes: 64 * 1024 },
  importMenu: { maxBytes: 32 * 1024, maxTextLength: 8000 },
  generateShoppingList: { maxBytes: 16 * 1024, maxDays: 7, maxDayLabelLength: 40, maxSlotLength: 200 },
} as const;
