// §52 last row — "Комиссия для своих субпартнёров (если партнёр — сеть с
// франчайзи)", and §54's rule that the calculation is one number both sides
// see.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SubpartnerError,
  readSubpartners,
  saveSubpartnerAgreement,
  splitSessionRevenue,
  subpartnerFeePctFor,
} from "./subpartner-service";

const PREFIX = "test_subp_";

let headId: string;
let subId: string;
let strangerId: string;
let headOwnerId: string;
let subOwnerId: string;
let subPointId: string;
let headPointId: string;

async function wipe() {
  await prisma.subpartnerAgreement.deleteMany({
    where: { head: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  headOwnerId = await user("head");
  subOwnerId = await user("sub");

  const network = async (slug: string, name: string, owner: string) =>
    (
      await prisma.chargerOperator.create({
        data: {
          slug: `${PREFIX}${slug}`,
          displayName: name,
          claimedById: owner,
          claimedAt: new Date(),
        },
      })
    ).id;
  headId = await network("head", "Head network", headOwnerId);
  subId = await network("sub", "Franchisee network", subOwnerId);
  strangerId = await network("stranger", "Unrelated network", subOwnerId);

  const point = async (operatorId: string, name: string) =>
    (
      await prisma.acceptancePoint.create({
        data: { operatorId, type: "CHARGING_STATION", name },
      })
    ).id;
  subPointId = await point(subId, "Franchisee point");
  headPointId = await point(headId, "Head point");
});

beforeEach(async () => {
  await prisma.subpartnerAgreement.deleteMany({ where: { headId } });
  await prisma.pricingRule.deleteMany({ where: { scope: "SUBPARTNER_FEE", operatorId: headId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("saveSubpartnerAgreement", () => {
  it("records the head network's percentage", async () => {
    const row = await saveSubpartnerAgreement({
      headId,
      subId,
      actorId: headOwnerId,
      chargeFeePct: 7.5,
      note: "Franchise 2026",
    });

    expect(Number(row.chargeFeePct)).toBe(7.5);
    expect(row.active).toBe(true);
    expect(row.note).toBe("Franchise 2026");
  });

  it("is the head network's agreement to write, not the franchisee's", async () => {
    await expect(
      saveSubpartnerAgreement({ headId, subId, actorId: subOwnerId, chargeFeePct: 1 }),
    ).rejects.toThrow(SubpartnerError);
  });

  it("refuses a percentage outside nought to a hundred", async () => {
    await expect(
      saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 140 }),
    ).rejects.toThrow(/percentage/i);
  });

  it("refuses a network taking a commission from itself", async () => {
    await expect(
      saveSubpartnerAgreement({ headId, subId: headId, actorId: headOwnerId, chargeFeePct: 5 }),
    ).rejects.toThrow(SubpartnerError);
  });

  it("changes the percentage rather than listing the franchisee twice", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    const again = await saveSubpartnerAgreement({
      headId,
      subId,
      actorId: headOwnerId,
      chargeFeePct: 5,
    });

    expect(Number(again.chargeFeePct)).toBe(5);
    expect(await prisma.subpartnerAgreement.count({ where: { headId } })).toBe(1);
  });

  it("records every change in the pricing journal (§54)", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 5 });

    const versions = await prisma.pricingRule.findMany({
      where: { scope: "SUBPARTNER_FEE", scopeId: subId },
      orderBy: { version: "desc" },
    });
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((versions[1].params as { chargeFeePct: number }).chargeFeePct).toBe(7.5);
  });
});

describe("subpartnerFeePctFor — what is taken at which point", () => {
  it("takes nothing where there is no agreement", async () => {
    expect(await subpartnerFeePctFor(subPointId)).toEqual({ pct: 0, headId: null });
  });

  it("takes the head network's percentage at the franchisee's point", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    expect(await subpartnerFeePctFor(subPointId)).toEqual({ pct: 7.5, headId });
  });

  it("takes nothing at the head network's own point", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    expect((await subpartnerFeePctFor(headPointId)).pct).toBe(0);
  });

  it("takes nothing at an unrelated network's point", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    const strangerPoint = await prisma.acceptancePoint.create({
      data: { operatorId: strangerId, type: "CHARGING_STATION", name: "Unrelated" },
    });
    expect((await subpartnerFeePctFor(strangerPoint.id)).pct).toBe(0);
  });

  it("takes nothing once the agreement is switched off", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    await saveSubpartnerAgreement({
      headId,
      subId,
      actorId: headOwnerId,
      chargeFeePct: 7.5,
      active: false,
    });
    expect((await subpartnerFeePctFor(subPointId)).pct).toBe(0);
  });

  it("takes nothing for a session with no point of ours", async () => {
    expect(await subpartnerFeePctFor(null)).toEqual({ pct: 0, headId: null });
  });
});

describe("splitSessionRevenue — §53's order: the platform first", () => {
  it("pays the platform, then the head network, and the rest is the partner's", () => {
    const split = splitSessionRevenue({
      amountFiat: 100,
      platformFeePct: 2,
      subpartnerFeePct: 10,
    });

    expect(split.platformFee).toBe(2);
    // Ten per cent of what is left after the platform, not of the gross.
    expect(split.subpartnerFee).toBe(9.8);
    expect(split.partnerNet).toBe(88.2);
    expect(split.platformFee + split.subpartnerFee + split.partnerNet).toBe(100);
  });

  it("gives everything to the partner when nobody charges anything", () => {
    const split = splitSessionRevenue({ amountFiat: 40, platformFeePct: 0, subpartnerFeePct: 0 });
    expect(split).toEqual({ platformFee: 0, subpartnerFee: 0, partnerNet: 40 });
  });

  it("rounds each share up to the cent and still adds up", () => {
    const split = splitSessionRevenue({
      amountFiat: 3.33,
      platformFeePct: 2,
      subpartnerFeePct: 7.5,
    });

    expect(split.platformFee).toBe(0.07);
    expect(split.subpartnerFee).toBe(0.25);
    expect(split.partnerNet).toBe(3.01);
    // Cents, so the comparison is made in cents too: adding three decimals
    // in binary floating point does not land on 3.33 exactly.
    expect(split.platformFee + split.subpartnerFee + split.partnerNet).toBeCloseTo(3.33, 10);
  });

  it("makes nothing out of nothing", () => {
    expect(splitSessionRevenue({ amountFiat: 0, platformFeePct: 2, subpartnerFeePct: 10 })).toEqual(
      { platformFee: 0, subpartnerFee: 0, partnerNet: 0 },
    );
  });
});

describe("readSubpartners — what each side sees", () => {
  it("shows the head network its franchisees", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    const view = await readSubpartners(headId);

    expect(view.asHead).toHaveLength(1);
    expect(view.asHead[0].partnerName).toBe("Franchisee network");
    expect(view.asHead[0].chargeFeePct).toBe(7.5);
    expect(view.asSub).toEqual([]);
  });

  it("shows the franchisee the same number, from the other side (§54)", async () => {
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 7.5 });
    const view = await readSubpartners(subId);

    expect(view.asSub).toHaveLength(1);
    expect(view.asSub[0].partnerName).toBe("Head network");
    expect(view.asSub[0].chargeFeePct).toBe(7.5);
    expect(view.asHead).toEqual([]);
  });
});

describe("splitSessionRevenue with a commission already taken", () => {
  it("uses the money the platform actually took, not a second percentage", () => {
    const split = splitSessionRevenue({
      amountFiat: 100,
      platformFeeFiat: 1.5,
      subpartnerFeePct: 10,
    });

    expect(split.platformFee).toBe(1.5);
    expect(split.subpartnerFee).toBe(9.85);
    expect(split.partnerNet).toBe(88.65);
  });

  it("never lets a commission exceed what was paid", () => {
    const split = splitSessionRevenue({
      amountFiat: 2,
      platformFeeFiat: 5,
      subpartnerFeePct: 10,
    });

    expect(split.platformFee).toBe(2);
    expect(split.subpartnerFee).toBe(0);
    expect(split.partnerNet).toBe(0);
  });

  it("treats a negative commission as none", () => {
    const split = splitSessionRevenue({
      amountFiat: 10,
      platformFeeFiat: -3,
      subpartnerFeePct: 0,
    });
    expect(split.platformFee).toBe(0);
    expect(split.partnerNet).toBe(10);
  });
});
