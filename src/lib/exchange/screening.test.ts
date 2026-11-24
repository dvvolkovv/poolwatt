// KYB and sanctions screening — ТЗ §4, §12 US-02.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  REQUIRED_SCREENINGS,
  ScreeningError,
  autoScreeningOpen,
  latestScreenings,
  missingScreenings,
  recordScreening,
  screeningBlocksApproval,
} from "./screening";
import { ListingError, decideApplication, submitApplication } from "./listing-service";

const PREFIX = "test_screen_";
let ownerId: string;
let operatorId: string;
let companyId: string;

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  ownerId = (await prisma.user.create({ data: { username: PREFIX + "owner", passwordHash: "x" } })).id;
  operatorId = (await prisma.user.create({ data: { username: PREFIX + "op", passwordHash: "x", role: "ADMIN" } })).id;
});

afterAll(cleanup);

let seq = 0;
beforeEach(async () => {
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  seq += 1;
  companyId = (
    await prisma.company.create({
      data: {
        legalName: `${PREFIX}Co${seq}`, country: "SK", regNumber: `${PREFIX}reg${seq}`,
        type: "PRODUCER", ownerUserId: ownerId,
        applications: { create: { status: "DRAFT", documents: [{ name: "a.pdf", url: "/x", bytes: 10, mime: "application/pdf" }] } },
      },
    })
  ).id;
  await submitApplication({ companyId, actorUserId: ownerId });
});

const clear = (kind: "KYB" | "SANCTIONS") =>
  recordScreening({
    companyId, kind, result: "CLEAR", provider: "manual",
    evidence: "ORSR extract 12345; EU consolidated list, no match",
    checkedById: operatorId,
  });

describe("autoScreeningOpen — §4, no provider contracted", () => {
  it("is closed by default, so the operator's own check is the only source", () => {
    expect(autoScreeningOpen({})).toBe(false);
    expect(autoScreeningOpen({ KYB_PROVIDER: "" })).toBe(false);
    expect(autoScreeningOpen({ KYB_PROVIDER: "manual" })).toBe(false);
    expect(autoScreeningOpen({ KYB_PROVIDER: "somevendor" })).toBe(true);
  });
});

describe("recordScreening", () => {
  it("keeps the verdict, who checked and what they looked at", async () => {
    const check = await clear("KYB");
    expect(check.result).toBe("CLEAR");
    expect(check.provider).toBe("manual");
    expect(check.checkedById).toBe(operatorId);
    expect(check.evidence).toContain("ORSR");
  });

  it("insists on evidence for a manual check — a bare verdict proves nothing", async () => {
    await expect(
      recordScreening({
        companyId, kind: "KYB", result: "CLEAR", provider: "manual",
        evidence: "  ", checkedById: operatorId,
      }),
    ).rejects.toThrow(ScreeningError);
  });

  it("records a hit with the matches the provider reported", async () => {
    const check = await recordScreening({
      companyId, kind: "SANCTIONS", result: "HIT", provider: "manual",
      evidence: "EU consolidated list", checkedById: operatorId,
      matches: [{ name: "Someone Else", list: "EU", score: 0.82 }],
    });
    expect(check.result).toBe("HIT");
    expect(check.matches).toHaveLength(1);
  });

  it("is append-only: a re-check is a new row, the old verdict stays", async () => {
    await recordScreening({
      companyId, kind: "KYB", result: "INCONCLUSIVE", provider: "manual",
      evidence: "registry down", checkedById: operatorId,
    });
    await clear("KYB");

    const all = await prisma.screeningCheck.findMany({ where: { companyId, kind: "KYB" } });
    expect(all).toHaveLength(2);
    const latest = await latestScreenings(companyId);
    expect(latest.KYB?.result).toBe("CLEAR");
  });
});

describe("missingScreenings / screeningBlocksApproval — §4", () => {
  it("lists what is still missing before approval", async () => {
    expect(await missingScreenings(companyId)).toEqual([...REQUIRED_SCREENINGS]);
    await clear("KYB");
    expect(await missingScreenings(companyId)).toEqual(["SANCTIONS"]);
    await clear("SANCTIONS");
    expect(await missingScreenings(companyId)).toEqual([]);
  });

  it("blocks approval while a required check is missing", async () => {
    expect(await screeningBlocksApproval(companyId)).toMatch(/KYB/);
    await clear("KYB");
    await clear("SANCTIONS");
    expect(await screeningBlocksApproval(companyId)).toBeNull();
  });

  it("blocks approval on a sanctions hit even when both checks exist", async () => {
    await clear("KYB");
    await recordScreening({
      companyId, kind: "SANCTIONS", result: "HIT", provider: "manual",
      evidence: "EU consolidated list", checkedById: operatorId,
    });
    expect(await screeningBlocksApproval(companyId)).toMatch(/SANCTIONS/);
  });

  it("blocks approval while a check is inconclusive", async () => {
    await clear("SANCTIONS");
    await recordScreening({
      companyId, kind: "KYB", result: "INCONCLUSIVE", provider: "manual",
      evidence: "registry down", checkedById: operatorId,
    });
    expect(await screeningBlocksApproval(companyId)).toMatch(/KYB/);
  });
});

describe("decideApplication with screening — US-02", () => {
  const application = () =>
    prisma.listingApplication.findFirstOrThrow({
      where: { companyId }, orderBy: { createdAt: "desc" },
    });

  it("refuses to approve a company that has not been screened", async () => {
    const app = await application();
    await expect(
      decideApplication({ applicationId: app.id, reviewerId: operatorId, approve: true }),
    ).rejects.toThrow(ListingError);
    expect((await application()).status).toBe("SUBMITTED");
  });

  it("approves once both checks are clear", async () => {
    await clear("KYB");
    await clear("SANCTIONS");
    const app = await application();

    const result = await decideApplication({
      applicationId: app.id, reviewerId: operatorId, approve: true,
    });

    expect(result.application.status).toBe("APPROVED");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).kybStatus).toBe("APPROVED");
  });

  it("still lets the operator reject an unscreened company with a comment", async () => {
    const app = await application();
    const result = await decideApplication({
      applicationId: app.id, reviewerId: operatorId, approve: false,
      comment: "Документы не читаются",
    });
    expect(result.application.status).toBe("REJECTED");
  });
});
