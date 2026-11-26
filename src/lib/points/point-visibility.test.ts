// §28 «Видимость» и §29.3. Отказ — это «нет такой карточки»: чужая карточка
// не должна подтверждать даже того, что она существует.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { mayViewPointId } from "./point-visibility";

const SLUG = "test_visibility_net";
const ZONE = "TESTVISIBILITY";
const PREFIX = "test_visibility_";

let ownerId: string;
let staffId: string;
let outsiderId: string;
let coopMemberId: string;
let clientId: string;
let publicId: string;
let coopPointId: string;
let clientsPointId: string;
let draftId: string;
let scopedPointId: string;

async function wipe() {
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.coopMember.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: "Visibility test coop" } });
  await prisma.company.deleteMany({ where: { regNumber: "VIS-COOP-0001" } });
  // Зона уходит последней: на неё смотрит кооператив.
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

async function makeUser(suffix: string) {
  return (
    await prisma.user.create({
      data: { username: `${PREFIX}${suffix}`, passwordHash: "x" },
    })
  ).id;
}

beforeAll(async () => {
  await wipe();

  ownerId = await makeUser("owner");
  staffId = await makeUser("staff");
  outsiderId = await makeUser("outsider");
  coopMemberId = await makeUser("coop");
  clientId = await makeUser("client");

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "Visibility test zone", currency: "EUR" },
  });

  const operator = await prisma.chargerOperator.create({
    data: {
      slug: SLUG,
      displayName: "Visibility test net",
      claimedById: ownerId,
      claimedAt: new Date(),
    },
  });

  const point = (name: string, visibility: string, status = "PUBLISHED") =>
    prisma.acceptancePoint.create({
      data: {
        operatorId: operator.id,
        type: "CHARGING_STATION",
        name,
        status: status as never,
        visibility: visibility as never,
        country: "SK",
        latitude: 50.61,
        longitude: 22.71,
        paymentMethods: ["TOKEN"],
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    });

  publicId = (await point("Public depot", "PUBLIC")).id;
  coopPointId = (await point("Coop depot", "COOP_MEMBERS")).id;
  clientsPointId = (await point("Clients depot", "OWN_CLIENTS")).id;
  draftId = (await point("Draft depot", "PUBLIC", "DRAFT")).id;
  scopedPointId = (await point("Scoped depot", "PUBLIC", "SUSPENDED")).id;

  // Сотрудник, которому разрешён ровно один пункт (§47).
  const role = await prisma.staffRole.create({
    data: { operatorId: operator.id, name: "Engineer", permissions: [] },
  });
  await prisma.employee.create({
    data: {
      operatorId: operator.id,
      userId: staffId,
      roleId: role.id,
      pointIds: [scopedPointId],
    },
  });

  // Член кооператива.
  const coopCompany = await prisma.company.create({
    data: {
      legalName: "Visibility test coop s.r.o.",
      country: "SK",
      regNumber: "VIS-COOP-0001",
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
      ownerUserId: ownerId,
    },
  });
  const coop = await prisma.cooperative.create({
    data: { name: "Visibility test coop", zoneId: zone.id, companyId: coopCompany.id },
  });
  await prisma.coopMember.create({
    data: { coopId: coop.id, userId: coopMemberId, status: "ACTIVE", shares: 1 },
  });

  // «Свой клиент» — тот, кто в этой сети уже платил.
  const wallet = await prisma.wallet.create({
    data: { ownerUserId: clientId, zoneId: zone.id, currency: "EUR" },
  });
  await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId: zone.id,
      pointId: clientsPointId,
      status: "CAPTURED",
      requestedKwh: 10,
      kwhFromBalance: 10,
      amountFiat: 3,
      capturedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await wipe();
});

describe("mayViewPoint — §28 visibility", () => {
  it("shows a published public card to anyone, signed in or not", async () => {
    expect(await mayViewPointId(publicId, null)).toBe("public");
    expect(await mayViewPointId(publicId, outsiderId)).toBe("public");
  });

  it("shows a members-only card to a cooperative member and nobody else", async () => {
    expect(await mayViewPointId(coopPointId, coopMemberId)).toBe("coop");
    expect(await mayViewPointId(coopPointId, outsiderId)).toBeNull();
    expect(await mayViewPointId(coopPointId, null)).toBeNull();
  });

  it("shows an own-clients card to somebody who has paid in that network", async () => {
    expect(await mayViewPointId(clientsPointId, clientId)).toBe("client");
    expect(await mayViewPointId(clientsPointId, outsiderId)).toBeNull();
  });

  it("hides a card that is not published yet from everybody but its network", async () => {
    expect(await mayViewPointId(draftId, outsiderId)).toBeNull();
    expect(await mayViewPointId(draftId, null)).toBeNull();
    expect(await mayViewPointId(draftId, ownerId)).toBe("owner");
  });

  it("lets a member of staff see only the points they were given", async () => {
    expect(await mayViewPointId(scopedPointId, staffId)).toBe("staff");
    // Приостановленный пункт вне его области — как будто его нет.
    expect(await mayViewPointId(draftId, staffId)).toBeNull();
  });

  it("has nothing to say about a point that is not there", async () => {
    expect(await mayViewPointId("no-such-point", ownerId)).toBeNull();
  });
});
