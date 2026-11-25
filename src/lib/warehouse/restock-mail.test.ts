// US-50's second half — "и уведомление". The request is already in the
// database; this is about somebody being told, and about not being told twice.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { notifyPendingRestockRequests, notifyRestockRequest } from "./restock-mail";

const PREFIX = "test_restock_";

let operatorId: string;
let ownerUserId: string;
let keeperUserId: string;
let central: string;
let vanWithKeeper: string;
let silentWarehouse: string;
let partId: string;

const sent: { to: string; subject: string; html: string }[] = [];
const spy = async (to: string, subject: string, html: string) => {
  sent.push({ to, subject, html });
};

async function wipe() {
  await prisma.restockRequest.deleteMany({
    where: { warehouse: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockItem.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.warehouse.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.sparePart.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

async function request(warehouseId: string) {
  return prisma.restockRequest.create({
    data: { warehouseId, partId, qtyAtRequest: 2, minQty: 5, suggestedQty: 3 },
  });
}

beforeAll(async () => {
  await wipe();

  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: {
        email: `${PREFIX}owner@example.test`,
        emailVerified: new Date(),
        preferredLocale: "ru",
      },
      create: {
        username: `${PREFIX}owner`,
        passwordHash: "x",
        email: `${PREFIX}owner@example.test`,
        emailVerified: new Date(),
        preferredLocale: "ru",
      },
    })
  ).id;
  keeperUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}keeper` },
      update: { email: `${PREFIX}keeper@example.test`, emailVerified: new Date() },
      create: {
        username: `${PREFIX}keeper`,
        passwordHash: "x",
        email: `${PREFIX}keeper@example.test`,
        emailVerified: new Date(),
      },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Restock network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  const role = await prisma.staffRole.create({
    data: { operatorId, name: "Engineer", permissions: [] },
  });
  const keeper = await prisma.employee.create({
    data: { operatorId, userId: keeperUserId, roleId: role.id },
  });

  central = (
    await prisma.warehouse.create({ data: { operatorId, name: "Central", kind: "CENTRAL" } })
  ).id;
  vanWithKeeper = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Van 1", kind: "VAN", keeperEmployeeId: keeper.id },
    })
  ).id;

  // A network nobody claimed and with no address of its own.
  const orphan = await prisma.chargerOperator.create({
    data: { slug: `${PREFIX}orphan`, displayName: "Nobody's network" },
  });
  silentWarehouse = (
    await prisma.warehouse.create({
      data: { operatorId: orphan.id, name: "Orphan store", kind: "CENTRAL" },
    })
  ).id;

  partId = (
    await prisma.sparePart.create({
      data: { operatorId, sku: "CBL-1", name: "CCS2 cable" },
    })
  ).id;
});

beforeEach(async () => {
  sent.length = 0;
  await prisma.restockRequest.deleteMany({ where: { partId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("notifyRestockRequest", () => {
  it("writes to the person who owns the network, naming the part and the numbers", async () => {
    const r = await request(central);

    expect(await notifyRestockRequest(r.id, { sendTo: spy })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(`${PREFIX}owner@example.test`);
    expect(sent[0].html).toContain("CCS2 cable");
    expect(sent[0].html).toContain("3");

    const after = await prisma.restockRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.notifiedAt).not.toBeNull();
  });

  it("writes to the engineer whose van it is, not to the owner", async () => {
    const r = await request(vanWithKeeper);

    await notifyRestockRequest(r.id, { sendTo: spy });
    expect(sent[0].to).toBe(`${PREFIX}keeper@example.test`);
  });

  it("does not write twice about one request", async () => {
    const r = await request(central);
    await notifyRestockRequest(r.id, { sendTo: spy });
    await notifyRestockRequest(r.id, { sendTo: spy });
    expect(sent).toHaveLength(1);
  });

  it("stops owing a letter when there is nobody to write to", async () => {
    const r = await prisma.restockRequest.create({
      data: {
        warehouseId: silentWarehouse,
        partId,
        qtyAtRequest: 0,
        minQty: 2,
        suggestedQty: 2,
      },
    });

    expect(await notifyRestockRequest(r.id, { sendTo: spy })).toBe(false);
    expect(sent).toHaveLength(0);
    const after = await prisma.restockRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.notifiedAt).not.toBeNull();
  });

  it("leaves the request owing when the mail server refuses", async () => {
    const r = await request(central);
    const broken = async () => {
      throw new Error("smtp down");
    };

    expect(await notifyRestockRequest(r.id, { sendTo: broken })).toBe(false);
    const after = await prisma.restockRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.notifiedAt).toBeNull();
  });

  it("says nothing about a request that was already dealt with", async () => {
    const r = await request(central);
    await prisma.restockRequest.update({
      where: { id: r.id },
      data: { status: "ORDERED" },
    });

    expect(await notifyRestockRequest(r.id, { sendTo: spy })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("notifyPendingRestockRequests — the sweep", () => {
  it("takes the ones nobody has been told about", async () => {
    const owing = await request(central);
    const told = await request(vanWithKeeper);
    await prisma.restockRequest.update({
      where: { id: told.id },
      data: { notifiedAt: new Date() },
    });

    const count = await notifyPendingRestockRequests({ sendTo: spy });
    expect(count).toBe(1);
    const after = await prisma.restockRequest.findUniqueOrThrow({ where: { id: owing.id } });
    expect(after.notifiedAt).not.toBeNull();
  });
});
