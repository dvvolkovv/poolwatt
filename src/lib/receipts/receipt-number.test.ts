// §46 — a receipt is a document, and a document has a number and a way to
// check it. Both have to be there the moment the receipt is written, not
// bolted on later: a chargeless receipt in the wallet history is a bug.

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { newVerifyCode, nextReceiptNumber, receiptStamp } from "./receipt-number";

describe("receipt numbering", () => {
  it("numbers receipts PW-<year>-<6 digits>", async () => {
    const number = await nextReceiptNumber(prisma, new Date("2026-03-04T10:00:00Z"));
    expect(number).toMatch(/^PW-2026-\d{6}$/);
  });

  it("never gives the same number twice, even to concurrent callers", async () => {
    const at = new Date("2026-03-04T10:00:00Z");
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => nextReceiptNumber(prisma, at)),
    );
    expect(new Set(numbers).size).toBe(20);
  });

  it("carries the year of issue", async () => {
    const number = await nextReceiptNumber(prisma, new Date("2027-01-01T00:00:00Z"));
    expect(number.startsWith("PW-2027-")).toBe(true);
  });

  it("mints an unguessable verification code", () => {
    const codes = Array.from({ length: 200 }, () => newVerifyCode());
    expect(new Set(codes).size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{32}$/);
  });

  it("stamps a receipt with both at once", async () => {
    const stamp = await receiptStamp(prisma, new Date("2026-03-04T10:00:00Z"));
    expect(stamp.number).toMatch(/^PW-2026-\d{6}$/);
    expect(stamp.verifyCode).toMatch(/^[0-9a-f]{32}$/);
  });
});
