// Resolve the active display currency. For Phase 1 it's always USD; the
// reference project reads from the user's preferences via Auth.js + Prisma —
// we'll wire that in Phase 3.

import { DEFAULT_CURRENCY, type Currency } from "./currency";

export async function getCurrency(): Promise<Currency> {
  return DEFAULT_CURRENCY;
}
