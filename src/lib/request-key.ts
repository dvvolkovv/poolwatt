// A key for one user intent — ТЗ §15 "Все POST-запросы с ключом
// идемпотентности".
//
// The browser mints it before the first attempt and reuses it for every retry
// of the same intent, so a double-clicked "buy" button cannot become two
// orders. A new intent (amount changed, previous order accepted) gets a new
// key.

export function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Non-secure contexts have no randomUUID; this is still unique per client.
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
