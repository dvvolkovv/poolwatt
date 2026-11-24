// US-23 — "свободен сейчас". ТЗ §27 wants the pin to say free, busy or out of
// service; §29.4 wants the first such report to be what publishes the card.
//
// The channel is our own method with the point's key and an HMAC signature
// (§15), not OCPP: a bridge to a particular charging network is an
// integration, and this has to work for a household powerbank too.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { issuePointKey, reportAvailability, revokePointKey } from "./point-availability";
import { restCanonicalString, signCanonical } from "@/lib/exchange/equipment-signature";

const PREFIX = "test_avail_";
const SLUG = `${PREFIX}net`;

let operatorId: string;
let ownerUserId: string;
let pointId: string;

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

async function seedPoint(status: "TEST" | "PUBLISHED" | "DRAFT" = "TEST") {
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "Availability test point",
      status,
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      latitude: 48.15,
      longitude: 17.11,
      howToFind: "level -1",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      connectors: {
        create: [
          { type: "CCS2", powerKw: 50, currentAc: false, quantity: 2 },
          { type: "TYPE2", powerKw: 22, currentAc: true, quantity: 1 },
        ],
      },
    },
    include: { connectors: true },
  });
  return point;
}

beforeAll(async () => {
  vi.stubEnv("API_KEY_ENC_KEY", randomBytes(32).toString("base64"));
  await wipe();
  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: {},
      create: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Availability test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.acceptancePoint.deleteMany({ where: { operatorId } });
  pointId = (await seedPoint()).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("issuePointKey — the equipment credential (§15, §28)", () => {
  it("shows the plaintext once and stores only a hash", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "charger box");

    expect(issued.token).toMatch(/^pwp_/);
    const stored = await prisma.pointApiKey.findUniqueOrThrow({ where: { id: issued.keyId } });
    expect(stored.tokenHash).toBe(createHash("sha256").update(issued.token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    expect(issued.signingSecret).toBeTruthy();
  });

  it("refuses a key to somebody who does not own the network", async () => {
    const stranger = await prisma.user.upsert({
      where: { username: `${PREFIX}stranger` },
      update: {},
      create: { username: `${PREFIX}stranger`, passwordHash: "x" },
    });
    await expect(issuePointKey(pointId, stranger.id, "nope")).rejects.toThrow(/not your/i);
  });

  it("stops accepting a revoked key", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "to revoke");
    await revokePointKey(issued.keyId, ownerUserId);

    await expect(
      reportAvailability(signed(issued, [{ type: "CCS2", status: "FREE" }])),
    ).rejects.toThrow(/key/i);
  });
});

describe("reportAvailability — what the pin says (§27)", () => {
  it("sets each connector's occupancy and stamps when it was heard", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "box");

    const result = await reportAvailability(
      signed(issued, [
        { type: "CCS2", status: "BUSY" },
        { type: "TYPE2", status: "FREE" },
      ]),
    );

    expect(result.updated).toBe(2);
    const connectors = await prisma.pointConnector.findMany({ where: { pointId } });
    expect(connectors.find((c) => c.type === "CCS2")?.status).toBe("BUSY");
    expect(connectors.find((c) => c.type === "TYPE2")?.status).toBe("FREE");
    expect(connectors.every((c) => c.statusAt != null)).toBe(true);
    const point = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: pointId } });
    expect(point.lastSeenAt).not.toBeNull();
  });

  it("publishes the point on the first report — §29.4", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "box");

    const result = await reportAvailability(signed(issued, [{ type: "CCS2", status: "FREE" }]));

    expect(result.status).toBe("PUBLISHED");
    const point = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: pointId } });
    expect(point.publishedAt).not.toBeNull();
  });

  it("leaves a connector it said nothing about alone", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "box");
    await reportAvailability(signed(issued, [{ type: "CCS2", status: "BUSY" }]));

    const type2 = await prisma.pointConnector.findFirstOrThrow({
      where: { pointId, type: "TYPE2" },
    });
    expect(type2.status).toBe("UNKNOWN");
  });

  it("refuses an unsigned request when the key has a signing secret", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "box");

    await expect(
      reportAvailability({
        token: issued.token,
        body: { connectors: [{ type: "CCS2", status: "FREE" }] },
        signature: null,
        timestamp: null,
        path: `/v1/points/${pointId}/availability`,
      }),
    ).rejects.toThrow(/signature/i);
  });

  it("refuses a body that was changed after it was signed", async () => {
    const issued = await issuePointKey(pointId, ownerUserId, "box");
    const request = signed(issued, [{ type: "CCS2", status: "FREE" }]);
    request.body = { connectors: [{ type: "CCS2", status: "BUSY" }] };

    await expect(reportAvailability(request)).rejects.toThrow(/signature/i);
  });

  it("refuses a key that belongs to another point", async () => {
    const other = await seedPoint();
    const issued = await issuePointKey(other.id, ownerUserId, "other box");

    const request = signed(issued, [{ type: "CCS2", status: "FREE" }]);
    request.path = `/v1/points/${pointId}/availability`;

    await expect(reportAvailability(request)).rejects.toThrow();
  });

  it("refuses an unknown token outright", async () => {
    await expect(
      reportAvailability({
        token: "pwp_nothing",
        body: { connectors: [] },
        signature: null,
        timestamp: null,
        path: `/v1/points/${pointId}/availability`,
      }),
    ).rejects.toThrow(/key/i);
  });
});

/** Build the request the equipment would send, signed the §15 way. */
function signed(
  issued: { token: string; signingSecret: string | null; pointId: string },
  connectors: { type: string; status: string }[],
) {
  const body = { connectors };
  const path = `/v1/points/${issued.pointId}/availability`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signCanonical(
    issued.signingSecret!,
    restCanonicalString({ timestamp, method: "POST", path, body: JSON.stringify(body) }),
  );
  return { token: issued.token, body, signature, timestamp, path };
}
