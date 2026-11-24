// Personal settlement accounts — ТЗ §19 (US-13) and §21.
//
// The platform's EMI licence (Lithuania) holds one segregated client-funds
// account; each listed participant and each KYC'd user gets a virtual IBAN
// pointing into it. The EMI assigns the IBAN. Until that integration exists,
// `generateIban` stands in for it as a sandbox that never runs in production
// (see gates.ts).

import { Prisma, SettlementAccountStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { num } from "./decimal";
import { FeatureClosedError, assertIbansOpen, publishableIban } from "./gates";
import { hasVerifiedKyc } from "./membership";
import { roundMoney } from "./precision";

const IBAN_COUNTRY = "LT";
/** Sandbox bank code: not ours, not any bank's we know of. */
const IBAN_BANK_CODE = "21000";

/** ISO 13616 / ISO 7064 mod-97-10 check digits. */
export function ibanCheckDigits(countryCode: string, bban: string): string {
  const rearranged = `${bban}${countryCode}00`;
  let remainder = 0;
  for (const ch of rearranged.toUpperCase()) {
    const value = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  const check = 98 - remainder;
  return check.toString().padStart(2, "0");
}

export function isValidIban(iban: string): boolean {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(clean)) return false;
  const rearranged = `${clean.slice(4)}${clean.slice(0, 4)}`;
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * Build a structurally valid LT IBAN from an 11-digit account serial.
 * LT IBANs are LT + 2 check digits + 5-digit bank code + 11-digit account.
 */
export function generateIban(serial: number): string {
  const account = String(serial).padStart(11, "0").slice(-11);
  const bban = `${IBAN_BANK_CODE}${account}`;
  return `${IBAN_COUNTRY}${ibanCheckDigits(IBAN_COUNTRY, bban)}${bban}`;
}

async function nextIban(db: Db): Promise<string> {
  assertIbansOpen();
  // Serial = row count + a random tail, retried on collision. Good enough
  // while the IBAN space is local; the provider assigns them for real later.
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await db.settlementAccount.count();
    const serial = (count + 1) * 1000 + Math.floor(Math.random() * 1000);
    const iban = generateIban(serial);
    const clash = await db.settlementAccount.findUnique({ where: { iban } });
    if (!clash) return iban;
  }
  throw new Error("Could not allocate a free IBAN after 5 attempts");
}

/** US-13 — open the account for an approved company. Idempotent. */
export async function openCompanyAccount(db: Db, companyId: string, currency = "EUR") {
  assertIbansOpen();
  const existing = await db.settlementAccount.findUnique({ where: { companyId } });
  if (existing) return existing;

  const account = await db.settlementAccount.create({
    data: { companyId, iban: await nextIban(db), currency },
  });
  await writeAudit(db, {
    actor: "system",
    entity: "SettlementAccount",
    entityId: account.id,
    action: "account.opened",
    after: { companyId, iban: account.iban, currency },
  });
  return account;
}

/** §21 — open the personal account of a KYC'd user. Idempotent. */
export async function openUserAccount(db: Db, userId: string, currency = "EUR") {
  assertIbansOpen();
  if (!(await hasVerifiedKyc(db, userId))) {
    throw new FeatureClosedError("A personal account needs verified KYC (ТЗ §21)");
  }
  const existing = await db.settlementAccount.findUnique({ where: { userId } });
  if (existing) return existing;

  const account = await db.settlementAccount.create({
    data: { userId, iban: await nextIban(db), currency },
  });
  await writeAudit(db, {
    actor: "system",
    entity: "SettlementAccount",
    entityId: account.id,
    action: "account.opened",
    after: { userId, iban: account.iban, currency },
  });
  return account;
}

/** Book a statement line and move the account balance (§19 statement). */
export async function bookEntry(
  db: Db,
  args: { accountId: string; amount: number; description: string; reference?: string | null },
) {
  const amount = roundMoney(args.amount);
  if (amount === 0) throw new RangeError("Cannot book a zero-amount entry");

  const account = await db.settlementAccount.findUniqueOrThrow({
    where: { id: args.accountId },
  });
  if (account.status !== SettlementAccountStatus.ACTIVE) {
    throw new Error(`Account ${account.iban} is ${account.status}`);
  }

  const entry = await db.settlementEntry.create({
    data: {
      accountId: args.accountId,
      amount: new Prisma.Decimal(amount),
      currency: account.currency,
      description: args.description,
      reference: args.reference ?? null,
    },
  });
  await db.settlementAccount.update({
    where: { id: args.accountId },
    data: { balance: { increment: new Prisma.Decimal(amount) } },
  });
  return entry;
}

export interface StatementLine {
  id: string;
  amount: number;
  currency: string;
  description: string;
  reference: string | null;
  bookedAt: string;
}

/** GET /v1/accounts/{id}/statement. */
export async function readStatement(
  accountId: string,
  opts: { from?: Date; to?: Date; limit?: number } = {},
  db: Db = prisma,
): Promise<{ iban: string | null; currency: string; balance: number; lines: StatementLine[] }> {
  const account = await db.settlementAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: {
      entries: {
        where: {
          ...(opts.from || opts.to
            ? { bookedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
            : {}),
        },
        orderBy: { bookedAt: "desc" },
        take: Math.min(opts.limit ?? 100, 500),
      },
    },
  });

  return {
    iban: publishableIban(account.iban),
    currency: account.currency,
    balance: num(account.balance),
    lines: account.entries.map((e) => ({
      id: e.id,
      amount: num(e.amount),
      currency: e.currency,
      description: e.description,
      reference: e.reference,
      bookedAt: e.bookedAt.toISOString(),
    })),
  };
}
