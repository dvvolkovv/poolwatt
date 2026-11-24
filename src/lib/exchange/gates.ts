// Features that stay shut until something outside the code exists: a bank that
// issues IBANs (ТЗ §19, §21), a lawyer's opinion on transfers (§24.4).

type Env = Record<string, string | undefined>;

/** The feature is not available yet; the API answers 503, not 400. */
export class FeatureClosedError extends Error {}

/**
 * IBANs are issued by the EMI. Until that integration exists the only source is
 * a local generator that invents account numbers, so it is a sandbox and never
 * runs in production: money sent to an invented IBAN is lost.
 */
export function ibansOpen(env: Env = process.env): boolean {
  return env.IBAN_PROVIDER === "sandbox" && env.NODE_ENV !== "production";
}

export function assertIbansOpen(): void {
  if (!ibansOpen()) {
    throw new FeatureClosedError("Settlement accounts are not available yet");
  }
}

/** The IBAN if it may be shown to anyone, otherwise null. */
export function publishableIban(
  iban: string | null | undefined,
  env: Env = process.env,
): string | null {
  return iban && ibansOpen(env) ? iban : null;
}

/** §24.4 — "подтвердить юридическим заключением до запуска функции". */
export function transfersOpen(env: Env = process.env): boolean {
  return env.KWH_TRANSFERS_ENABLED === "true";
}

export function assertTransfersOpen(): void {
  if (!transfersOpen()) {
    throw new FeatureClosedError("kWh transfers are not available yet");
  }
}
