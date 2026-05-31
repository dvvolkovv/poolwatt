import { randomInt } from "crypto";

export function generateClaimToken(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
