// Kept as a hard stop even when a historical script is invoked directly.
// These scripts lack authenticated ownership and used the production .env.local.
throw new Error(
  "Legacy Supabase probe disabled. Use npm run db:start, npm run db:seed and npm run test:db (verified local target only).",
);
export {};
