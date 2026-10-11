// Request limits for the paid AI routes, sized from real payloads (A3).
export const aiRequestLimits = {
  generateMenu: { maxBytes: 64 * 1024 },
  // C6: also a cap on lines (a week is ~25), so one paste is one week, and on the AI's answer. The
  // text limits must equal importTextLimits in @/lib/importMenu (what the browser checks; tested).
  importMenu: { maxBytes: 32 * 1024, maxTextLength: 8000, maxLines: 80, maxCompletionTokens: 2000 },
  substituteDish: { maxBytes: 16 * 1024 },
  generateShoppingList: { maxBytes: 16 * 1024, maxDays: 7, maxDayLabelLength: 40, maxSlotLength: 200 },
  // C2: one dish title and where it is in the week.
  dishCard: { maxBytes: 4 * 1024 },
} as const;
