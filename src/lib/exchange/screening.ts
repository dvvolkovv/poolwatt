// KYB and sanctions screening — ТЗ §4 ("Проверка KYB, санкционный скрининг,
// ручная модерация оператором"), §12 US-02.
//
// No KYB provider is contracted yet, so the automated path stays shut and the
// operator's own check is the record: they look the company up in its national
// register and search the consolidated sanctions lists, then write down what
// they saw. That is honest — the verdict comes from a person who really
// checked, not from a number this code invented — and it is what makes US-02's
// "результат KYB и санкционного скрининга" something the operator actually
// sees before deciding.
//
// Approval is blocked until both checks are on file and clear (§4: "Не
// активировать выпуск токенов, пока не пройдены проверка документов…").

import { Prisma, type ScreeningKind, type ScreeningResult } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";

type Env = Record<string, string | undefined>;

/** §4 — what must be on file before a company is approved. */
export const REQUIRED_SCREENINGS: readonly ScreeningKind[] = ["KYB", "SANCTIONS"];

/** Written on checks the operator ran by hand. */
export const MANUAL_PROVIDER = "manual";

export class ScreeningError extends Error {}

/**
 * An automated provider is configured. Closed by default: until a vendor is
 * contracted there is nothing to call, and a fabricated "CLEAR" would be worse
 * than no answer at all.
 */
export function autoScreeningOpen(env: Env = process.env): boolean {
  const provider = env.KYB_PROVIDER?.trim();
  return Boolean(provider) && provider !== MANUAL_PROVIDER;
}

export interface ScreeningMatch {
  name: string;
  list?: string;
  score?: number;
  note?: string;
}

export interface RecordScreeningInput {
  companyId: string;
  kind: ScreeningKind;
  result: ScreeningResult;
  provider: string;
  evidence?: string | null;
  matches?: ScreeningMatch[];
  checkedById: string | null;
}

/** One check goes on file. Append-only: a re-check is a new row. */
export async function recordScreening(input: RecordScreeningInput, db: Db = prisma) {
  const provider = input.provider.trim() || MANUAL_PROVIDER;
  const evidence = input.evidence?.trim() || null;
  // A manual verdict with nothing behind it is not a check, it is an opinion.
  if (provider === MANUAL_PROVIDER && !evidence) {
    throw new ScreeningError(
      "A manual check needs evidence: which register or list was searched, and under what reference",
    );
  }

  const check = await db.screeningCheck.create({
    data: {
      companyId: input.companyId,
      kind: input.kind,
      result: input.result,
      provider,
      evidence,
      matches: (input.matches ?? []) as unknown as Prisma.InputJsonValue,
      checkedById: input.checkedById,
    },
  });

  await writeAudit(db, {
    actor: input.checkedById ?? "system",
    entity: "Company",
    entityId: input.companyId,
    action: "screening.recorded",
    after: {
      kind: check.kind,
      result: check.result,
      provider: check.provider,
      matches: (input.matches ?? []).length,
    },
  });
  return check;
}

export type LatestScreenings = Partial<
  Record<ScreeningKind, { result: ScreeningResult; provider: string; checkedAt: Date; evidence: string | null }>
>;

/** The newest check of each kind — what the operator's page shows. */
export async function latestScreenings(
  companyId: string,
  db: Db = prisma,
): Promise<LatestScreenings> {
  const rows = await db.screeningCheck.findMany({
    where: { companyId },
    orderBy: { checkedAt: "desc" },
  });
  const out: LatestScreenings = {};
  for (const row of rows) {
    if (out[row.kind]) continue; // ordered desc, so the first one wins
    out[row.kind] = {
      result: row.result,
      provider: row.provider,
      checkedAt: row.checkedAt,
      evidence: row.evidence,
    };
  }
  return out;
}

/** Required kinds with no check on file at all. */
export async function missingScreenings(
  companyId: string,
  db: Db = prisma,
): Promise<ScreeningKind[]> {
  const latest = await latestScreenings(companyId, db);
  return REQUIRED_SCREENINGS.filter((kind) => !latest[kind]);
}

/**
 * Why this company cannot be approved yet, or null if it can. §4 — a missing,
 * inconclusive or hit check all stop an approval; only the operator's own
 * decision to reject is unaffected.
 */
export async function screeningBlocksApproval(
  companyId: string,
  db: Db = prisma,
): Promise<string | null> {
  const latest = await latestScreenings(companyId, db);
  const missing = REQUIRED_SCREENINGS.filter((kind) => !latest[kind]);
  if (missing.length > 0) {
    return `No ${missing.join(" and ")} check on file (ТЗ §4)`;
  }
  const unresolved = REQUIRED_SCREENINGS.filter((kind) => latest[kind]!.result !== "CLEAR");
  if (unresolved.length > 0) {
    return unresolved
      .map((kind) => `${kind} is ${latest[kind]!.result}`)
      .join("; ");
  }
  return null;
}
