import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import {
  updateChargerOperatorCard,
  unlinkChargerOperatorClaim,
  updateChargerOperatorPrice,
  createChargerOperatorApiKey,
  revokeChargerOperatorApiKey,
} from "./actions";
import { hashToken } from "@/lib/charger-operator-tokens";

const TEST_SLUG = "test-co-cabinet";
const TEST_USERNAME = "test_co_user";
const OTHER_USERNAME = "test_co_other";

let testOpId: string;
let ownerUserId: string;
let otherUserId: string;

async function cleanup() {
  // ApiKey rows cascade-delete with the operator, but be explicit to keep the
  // intent obvious in case the FK is ever changed.
  await prisma.chargerOperatorApiKey.deleteMany({ where: { operator: { slug: TEST_SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: TEST_SLUG } });
  await prisma.user.deleteMany({ where: { username: { in: [TEST_USERNAME, OTHER_USERNAME] } } });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({ data: { username: TEST_USERNAME, passwordHash: "x" } })).id;
  otherUserId = (await prisma.user.create({ data: { username: OTHER_USERNAME, passwordHash: "x" } })).id;
  testOpId = (await prisma.chargerOperator.create({
    data: {
      slug: TEST_SLUG, displayName: "Test Op", aliases: ["Test Op"],
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  await prisma.chargerOperator.update({
    where: { id: testOpId },
    data: {
      displayName: "Test Op",
      description: null, websiteUrl: null, logoUrl: null, email: null, phone: null,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  });
});

describe("updateChargerOperatorCard", () => {
  it("updates fields when caller is the owner", async () => {
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "Renamed Op",
      description: "We run fast chargers.",
      websiteUrl: "https://renamed.example",
      logoUrl: "https://renamed.example/l.png",
      email: "ops@renamed.example",
      phone: "+1",
    });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.displayName).toBe("Renamed Op");
    expect(after?.description).toBe("We run fast chargers.");
    expect(after?.email).toBe("ops@renamed.example");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "Hostile rename",
    });
    expect(r.ok).toBe(false);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.displayName).toBe("Test Op");
  });

  it("rejects when displayName is empty", async () => {
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "",
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.displayName).toBeDefined();
  });
});

describe("updateChargerOperatorPrice", () => {
  it("sets price + currency + timestamp when owner submits", async () => {
    const before = Date.now();
    const r = await updateChargerOperatorPrice({
      operatorId: testOpId,
      pricePerKwh: 0.42,
      currency: "EUR",
    });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.pricePerKwh?.toString()).toBe("0.42");
    expect(after?.priceCurrency).toBe("EUR");
    expect(after?.priceUpdatedAt).toBeInstanceOf(Date);
    expect(after?.priceUpdatedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("clears all three fields when pricePerKwh is null", async () => {
    await prisma.chargerOperator.update({
      where: { id: testOpId },
      data: { pricePerKwh: "0.55", priceCurrency: "USD", priceUpdatedAt: new Date() },
    });
    const r = await updateChargerOperatorPrice({
      operatorId: testOpId,
      pricePerKwh: null,
      currency: null,
    });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.pricePerKwh).toBeNull();
    expect(after?.priceCurrency).toBeNull();
    expect(after?.priceUpdatedAt).toBeNull();
  });

  it("rejects price without currency", async () => {
    const r = await updateChargerOperatorPrice({
      operatorId: testOpId,
      pricePerKwh: 0.5,
      currency: null,
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.currency).toBeDefined();
  });

  it("rejects zero / negative price", async () => {
    const r = await updateChargerOperatorPrice({
      operatorId: testOpId,
      pricePerKwh: 0,
      currency: "EUR",
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.pricePerKwh).toBeDefined();
  });

  it("rejects unsupported currency", async () => {
    const r = await updateChargerOperatorPrice({
      operatorId: testOpId,
      pricePerKwh: 0.4,
      // @ts-expect-error testing runtime rejection of a non-enum currency
      currency: "XYZ",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateChargerOperatorPrice({
      operatorId: testOpId,
      pricePerKwh: 0.4,
      currency: "EUR",
    });
    expect(r.ok).toBe(false);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.pricePerKwh).toBeNull();
  });
});

describe("createChargerOperatorApiKey", () => {
  it("returns plaintext once and stores only the hash", async () => {
    const r = await createChargerOperatorApiKey({
      operatorId: testOpId,
      label: "Production gateway",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.plaintext).toMatch(/^pwco_/);
    const stored = await prisma.chargerOperatorApiKey.findUnique({ where: { id: r.id } });
    expect(stored?.tokenHash).toBe(hashToken(r.plaintext));
    expect(stored?.label).toBe("Production gateway");
    expect(stored?.revokedAt).toBeNull();
    expect(stored?.lastUsedAt).toBeNull();
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await createChargerOperatorApiKey({ operatorId: testOpId, label: "Hostile" });
    expect(r.ok).toBe(false);
  });

  it("rejects empty label", async () => {
    const r = await createChargerOperatorApiKey({ operatorId: testOpId, label: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.label).toBeDefined();
  });
});

describe("revokeChargerOperatorApiKey", () => {
  it("sets revokedAt for the owner", async () => {
    const created = await createChargerOperatorApiKey({
      operatorId: testOpId,
      label: "Temporary",
    });
    if (!created.ok) throw new Error("create failed");
    const r = await revokeChargerOperatorApiKey({ keyId: created.id });
    expect(r.ok).toBe(true);
    const stored = await prisma.chargerOperatorApiKey.findUnique({ where: { id: created.id } });
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it("rejects non-owner revoke", async () => {
    const created = await createChargerOperatorApiKey({
      operatorId: testOpId,
      label: "Yet another",
    });
    if (!created.ok) throw new Error("create failed");
    mockUserId = otherUserId;
    const r = await revokeChargerOperatorApiKey({ keyId: created.id });
    expect(r.ok).toBe(false);
    const stored = await prisma.chargerOperatorApiKey.findUnique({ where: { id: created.id } });
    expect(stored?.revokedAt).toBeNull();
  });
});

describe("unlinkChargerOperatorClaim", () => {
  it("clears claim when owner unlinks", async () => {
    const r = await unlinkChargerOperatorClaim({ operatorId: testOpId });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.claimedById).toBeNull();
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await unlinkChargerOperatorClaim({ operatorId: testOpId });
    expect(r.ok).toBe(false);
  });
});
