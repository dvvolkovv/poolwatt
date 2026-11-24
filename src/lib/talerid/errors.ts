import type { TalerIdRefusal } from "./resolve-user";

/** `?error=` codes for the refusals our own code produces. */
export const TALERID_REFUSAL_CODE: Record<TalerIdRefusal, string> = {
  email_taken: "TalerIdEmailTaken",
  talerid_taken: "TalerIdTaken",
  already_linked: "TalerIdAlreadyLinked",
};

/** Keys under `auth.talerId.errors` in messages/*.json. */
export type TalerIdErrorKey = "cancelled" | "emailTaken" | "taken" | "alreadyLinked" | "failed";

const KEYS = new Map<string, TalerIdErrorKey>([
  ["OAuthCallbackError", "cancelled"],
  ["AccessDenied", "cancelled"],
  [TALERID_REFUSAL_CODE.email_taken, "emailTaken"],
  [TALERID_REFUSAL_CODE.talerid_taken, "taken"],
  [TALERID_REFUSAL_CODE.already_linked, "alreadyLinked"],
]);

/** Message key for an `?error=` value; null when there is nothing to show. */
export function talerIdErrorKey(code: string | string[] | undefined): TalerIdErrorKey | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value || value === "CredentialsSignin") return null;
  return KEYS.get(value) ?? "failed";
}
