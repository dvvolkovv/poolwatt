// Prisma returns Decimal columns as Prisma.Decimal; the exchange domain logic
// runs on plain numbers rounded at the scales in precision.ts. These two
// helpers are the only conversion points, so the boundary stays visible.

import { Prisma } from "@prisma/client";

type Numeric = Prisma.Decimal | number | string | null | undefined;

/** Decimal → number. null/undefined become 0. */
export function num(value: Numeric): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return value.toNumber();
}

/** Decimal → number, preserving null (for optional prices). */
export function numOrNull(value: Numeric): number | null {
  if (value == null) return null;
  return num(value);
}
