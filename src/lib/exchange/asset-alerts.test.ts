// US-29 — "хочу получать уведомление об аварии", ТЗ §30 "Уведомления".
// The criterion is push and email within a minute of the event. Push waits on
// keys only the owner can get; what this covers is the event itself, the
// mail, and the promise that one fault does not mail every minute.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  detectLinkLoss,
  notifyPendingAlerts,
  raiseAlert,
  resolveAlert,
} from "./asset-alerts";

const PREFIX = "test_alert_";
const ZONE_CODE = "TESTALERT";

let zoneId: string;
let companyId: string;
let assetId: string;
let ownerUserId: string;

const sent: { to: string; subject: string }[] = [];
const mailer = async (to: string, subject: string) => {
  sent.push({ to, subject });
};

async function wipe() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (!zone) return;
  await prisma.assetAlert.deleteMany({ where: { asset: { gridZoneId: zone.id } } });
  await prisma.meterReading.deleteMany({ where: { zoneId: zone.id } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Alert test zone",
      currency: "EUR",
      intervalMinutes: 60,
    },
  });
  zoneId = zone.id;

  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: { email: `${PREFIX}owner@example.test`, emailVerified: new Date() },
      create: {
        username: `${PREFIX}owner`,
        passwordHash: "x",
        email: `${PREFIX}owner@example.test`,
        // Alarms only go to an address the account has proved it owns.
        emailVerified: new Date(),
      },
    })
  ).id;

  companyId = (
    await prisma.company.create({
      data: {
        legalName: `${PREFIX}co s.r.o.`,
        country: "SK",
        regNumber: `${PREFIX}reg`,
        type: "PRODUCER",
        kybStatus: "APPROVED",
        ownerUserId,
        contactEmail: `${PREFIX}ops@example.test`,
      },
    })
  ).id;
});

beforeEach(async () => {
  sent.length = 0;
  if (!zoneId) return;
  await prisma.assetAlert.deleteMany({ where: { asset: { gridZoneId: zoneId } } });
  await prisma.meterReading.deleteMany({ where: { zoneId } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zoneId } });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Alert test array",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
        activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("raiseAlert — one row per open fault (§30)", () => {
  it("opens an alert and leaves it owing a notification", async () => {
    const alert = await raiseAlert(prisma, {
      assetId,
      kind: "TELEMETRY_ANOMALY",
      note: "reading above capacity",
    });

    expect(alert).not.toBeNull();
    expect(alert!.notifiedAt).toBeNull();
    expect(alert!.resolvedAt).toBeNull();
  });

  it("does not open a second alert while the first is still open", async () => {
    await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });
    const again = await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "still silent" });

    expect(again).toBeNull();
    expect(await prisma.assetAlert.count({ where: { assetId } })).toBe(1);
  });

  it("opens a new alert once the old one is resolved", async () => {
    const first = await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });
    await resolveAlert(first!.id, ownerUserId, "cable replaced");
    const second = await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent again" });

    expect(second).not.toBeNull();
    expect(await prisma.assetAlert.count({ where: { assetId } })).toBe(2);
  });

  it("keeps faults of different kinds apart", async () => {
    await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });
    const other = await raiseAlert(prisma, {
      assetId,
      kind: "TELEMETRY_ANOMALY",
      note: "rejected reading",
    });
    expect(other).not.toBeNull();
  });
});

describe("notifyPendingAlerts — the engineer is told once (US-29)", () => {
  it("mails the owner and the company's contact, and marks the alert told", async () => {
    const alert = await raiseAlert(prisma, {
      assetId,
      kind: "TELEMETRY_ANOMALY",
      note: "reading above capacity",
    });

    const count = await notifyPendingAlerts({ sendTo: mailer });

    expect(count).toBe(1);
    expect(sent.map((s) => s.to).sort()).toEqual([
      `${PREFIX}ops@example.test`,
      `${PREFIX}owner@example.test`,
    ]);
    expect(sent[0].subject).toContain("Alert test array");
    const stored = await prisma.assetAlert.findUniqueOrThrow({ where: { id: alert!.id } });
    expect(stored.notifiedAt).not.toBeNull();
  });

  it("does not mail the same fault twice", async () => {
    await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });
    await notifyPendingAlerts({ sendTo: mailer });
    sent.length = 0;

    const second = await notifyPendingAlerts({ sendTo: mailer });

    expect(second).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("leaves the alert owing when the mail fails, so the next minute retries", async () => {
    const alert = await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });

    await notifyPendingAlerts({
      sendTo: async () => {
        throw new Error("smtp down");
      },
    });

    const stored = await prisma.assetAlert.findUniqueOrThrow({ where: { id: alert!.id } });
    expect(stored.notifiedAt).toBeNull();
  });
});

describe("detectLinkLoss — equipment that went quiet (§30)", () => {
  it("raises an alert after three intervals of silence", async () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    await prisma.meterReading.create({
      data: {
        assetId,
        zoneId,
        intervalStart: new Date("2026-11-24T07:00:00.000Z"),
        intervalEnd: new Date("2026-11-24T08:00:00.000Z"),
        energyKwh: new Prisma.Decimal(3),
        source: "rest",
        validationStatus: "VALID",
        receivedAt: new Date("2026-11-24T08:00:00.000Z"),
      },
    });

    const raised = await detectLinkLoss(now);

    expect(raised).toBe(1);
    const alert = await prisma.assetAlert.findFirstOrThrow({ where: { assetId } });
    expect(alert.kind).toBe("LINK_LOST");
  });

  it("says nothing about equipment that reported within the window", async () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    await prisma.meterReading.create({
      data: {
        assetId,
        zoneId,
        intervalStart: new Date("2026-11-24T10:00:00.000Z"),
        intervalEnd: new Date("2026-11-24T11:00:00.000Z"),
        energyKwh: new Prisma.Decimal(3),
        source: "rest",
        validationStatus: "VALID",
        receivedAt: new Date("2026-11-24T11:30:00.000Z"),
      },
    });

    expect(await detectLinkLoss(now)).toBe(0);
  });

  it("says nothing about an asset that has never reported at all", async () => {
    // Not a fault: the installer has not connected it yet.
    expect(await detectLinkLoss(new Date("2026-11-24T12:00:00.000Z"))).toBe(0);
  });

  it("ignores an asset that is not active", async () => {
    await prisma.asset.update({ where: { id: assetId }, data: { status: "SUSPENDED" } });
    await prisma.meterReading.create({
      data: {
        assetId,
        zoneId,
        intervalStart: new Date("2026-11-24T07:00:00.000Z"),
        intervalEnd: new Date("2026-11-24T08:00:00.000Z"),
        energyKwh: new Prisma.Decimal(3),
        source: "rest",
        validationStatus: "VALID",
        receivedAt: new Date("2026-11-24T08:00:00.000Z"),
      },
    });

    expect(await detectLinkLoss(new Date("2026-11-24T12:00:00.000Z"))).toBe(0);
  });
});

describe("resolveAlert — closing it (§30)", () => {
  it("records who cleared it and what they said", async () => {
    const alert = await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });

    await resolveAlert(alert!.id, ownerUserId, "router rebooted");

    const stored = await prisma.assetAlert.findUniqueOrThrow({ where: { id: alert!.id } });
    expect(stored.resolvedAt).not.toBeNull();
    expect(stored.resolvedBy).toBe(ownerUserId);
    expect(stored.resolutionNote).toBe("router rebooted");
  });

  it("refuses to close an alert twice", async () => {
    const alert = await raiseAlert(prisma, { assetId, kind: "LINK_LOST", note: "silent" });
    await resolveAlert(alert!.id, ownerUserId, "done");

    await expect(resolveAlert(alert!.id, ownerUserId, "again")).rejects.toThrow();
  });
});
