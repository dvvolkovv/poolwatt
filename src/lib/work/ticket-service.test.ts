// US-52, US-53 and US-54 — ТЗ §51 "Сообщение о поломке от клиента".
//
// The criteria: the station is filled in for the customer and the type comes
// from a list (US-52), the nearest working station is offered straight after
// (US-53), and a technical report produces a work order (US-54).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TicketError, nearestWorkingPoints, reportProblem } from "./ticket-service";

const PREFIX = "test_ticket_";
const SLUG = `${PREFIX}net`;
const ZONE = "TKTSVC";

let operatorId: string;
let reporterId: string;
let brokenPointId: string;
let brokenConnectorId: string;
let nearbyFreeId: string;
let nearbyBusyId: string;
let farFreeId: string;
let zoneId: string;
let walletId: string;
let strangerWalletId: string;

/** Настоящие первые байты: тип файла читается из них, а не из имени. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 9)]);

const LAT = 48.15;
const LNG = 17.11;

async function wipe() {
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operator: { slug: SLUG } } } });
  await prisma.ticket.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.payment.deleteMany({
    where: { wallet: { owner: { username: { startsWith: PREFIX } } } },
  });
  await prisma.wallet.deleteMany({ where: { owner: { username: { startsWith: PREFIX } } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

async function seedPoint(args: {
  name: string;
  lat: number;
  lng: number;
  connector: string;
  status: string;
}) {
  return prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: args.name,
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      latitude: args.lat,
      longitude: args.lng,
      howToFind: "by the lift",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      connectors: {
        create: [
          {
            type: args.connector as never,
            powerKw: new Prisma.Decimal(50),
            currentAc: false,
            quantity: 1,
            status: args.status as never,
          },
        ],
      },
      tariffs: { create: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.4, currency: "EUR" }] },
    },
    include: { connectors: true },
  });
}

let photosRoot: string;

beforeAll(async () => {
  await wipe();
  photosRoot = await mkdtemp(join(tmpdir(), "poolwatt-ticket-service-"));
  process.env.TICKET_PHOTOS_DIR = photosRoot;
  reporterId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}driver` },
      update: {},
      create: { username: `${PREFIX}driver`, passwordHash: "x" },
    })
  ).id;
  const owner = await prisma.user.upsert({
    where: { username: `${PREFIX}owner` },
    update: {},
    create: { username: `${PREFIX}owner`, passwordHash: "x" },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Ticket test network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  // §51.1 — заявка из истории зарядок, поэтому в мире есть сеанс.
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "Ticket service zone", currency: "EUR" },
    })
  ).id;
  walletId = (
    await prisma.wallet.create({ data: { ownerUserId: reporterId, zoneId, currency: "EUR" } })
  ).id;
  const stranger = await prisma.user.upsert({
    where: { username: `${PREFIX}stranger` },
    update: {},
    create: { username: `${PREFIX}stranger`, passwordHash: "x" },
  });
  strangerWalletId = (
    await prisma.wallet.create({
      data: { ownerUserId: stranger.id, zoneId, currency: "EUR" },
    })
  ).id;
});

/** Captured сеанс на указанном кошельке и сломанном пункте. */
async function seedPayment(wallet: string) {
  return prisma.payment.create({
    data: {
      walletId: wallet,
      zoneId,
      pointId: brokenPointId,
      requestedKwh: new Prisma.Decimal(20),
      amountFiat: new Prisma.Decimal(8),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
}

beforeEach(async () => {
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operatorId } } });
  await prisma.ticket.deleteMany({ where: { operatorId } });
  await prisma.payment.deleteMany({ where: { walletId: { in: [walletId, strangerWalletId] } } });
  await prisma.workOrder.deleteMany({ where: { operatorId } });
  await prisma.acceptancePoint.deleteMany({ where: { operatorId } });

  const broken = await seedPoint({
    name: "Broken point",
    lat: LAT,
    lng: LNG,
    connector: "CCS2",
    status: "FREE",
  });
  brokenPointId = broken.id;
  brokenConnectorId = broken.connectors[0].id;

  nearbyFreeId = (
    await seedPoint({ name: "Nearby free", lat: LAT + 0.003, lng: LNG, connector: "CCS2", status: "FREE" })
  ).id;
  nearbyBusyId = (
    await seedPoint({ name: "Nearby busy", lat: LAT + 0.004, lng: LNG, connector: "CCS2", status: "BUSY" })
  ).id;
  farFreeId = (
    await seedPoint({ name: "Far free", lat: LAT + 0.2, lng: LNG, connector: "CCS2", status: "FREE" })
  ).id;
  await seedPoint({ name: "Wrong plug", lat: LAT + 0.002, lng: LNG, connector: "TYPE2", status: "FREE" });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await rm(photosRoot, { recursive: true, force: true });
  delete process.env.TICKET_PHOTOS_DIR;
});

describe("reportProblem — thirty seconds' worth of form (US-52)", () => {
  it("takes a report with nothing but the point and the type", async () => {
    const result = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });

    expect(result.ticket.pointId).toBe(brokenPointId);
    expect(result.ticket.problemType).toBe("BLOCKED");
    expect(result.ticket.status).toBe("OPEN");
    expect(result.ticket.respondBy).not.toBeNull();
  });

  it("puts a technical report straight into work, because it already is", async () => {
    const result = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "DAMAGED_CABLE",
    });

    expect(result.ticket.status).toBe("IN_PROGRESS");
    expect(result.ticket.workOrderId).not.toBeNull();
  });

  it("takes a comment and photos when the customer bothers", async () => {
    const result = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "OTHER",
      comment: "Smells of burning",
      photos: [
        { filename: "one.jpg", bytes: JPEG },
        { filename: "two.jpg", bytes: JPEG },
      ],
    });

    expect(result.ticket.comment).toBe("Smells of burning");
    expect(result.ticket.photos).toHaveLength(2);
  });

  it("refuses a report about a point that is not there", async () => {
    await expect(
      reportProblem({ pointId: "no-such-point", reporterId, problemType: "NO_START" }),
    ).rejects.toThrow(TicketError);
  });
});

describe("reportProblem — a technical fault makes a work order (US-54)", () => {
  it("opens a work order with the fault, the photos and the equipment", async () => {
    const result = await reportProblem({
      pointId: brokenPointId,
      connectorId: brokenConnectorId,
      reporterId,
      problemType: "DAMAGED_CABLE",
      comment: "Insulation is cut",
      photos: [{ filename: "cut.jpg", bytes: JPEG }],
    });

    expect(result.workOrder).not.toBeNull();
    const order = await prisma.workOrder.findUniqueOrThrow({
      where: { id: result.workOrder!.id },
    });
    expect(order.pointId).toBe(brokenPointId);
    expect(order.type).toBe("REPAIR");
    expect(order.description).toContain("Insulation is cut");
    expect(order.photos).toEqual(result.ticket.photos);
    expect(order.partsNeeded).toContain("charging cable");
    expect(order.sourceTicketId).toBe(result.ticket.id);
  });

  it("takes the reported connector out of service, so the map stops promising it", async () => {
    await reportProblem({
      pointId: brokenPointId,
      connectorId: brokenConnectorId,
      reporterId,
      problemType: "NO_START",
    });

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: brokenConnectorId },
    });
    expect(connector.status).toBe("OUT_OF_SERVICE");
  });

  it("does not make a work order out of a blocked bay or a price complaint", async () => {
    const blocked = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });
    const price = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "WRONG_PRICE",
    });

    expect(blocked.workOrder).toBeNull();
    expect(price.workOrder).toBeNull();
    // And nothing was taken out of service over somebody parking badly.
    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: brokenConnectorId },
    });
    expect(connector.status).toBe("FREE");
  });

  it("gives a technical fault a tighter deadline than a complaint", async () => {
    const technical = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "DAMAGED_CABLE",
    });
    const complaint = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "WRONG_PRICE",
    });

    expect(technical.ticket.respondBy!.getTime()).toBeLessThan(
      complaint.ticket.respondBy!.getTime(),
    );
    expect(technical.ticket.priority).toBe("URGENT");
  });
});

describe("nearestWorkingPoints — the offer right after (US-53)", () => {
  it("offers the nearest free points with the same plug, nearest first", async () => {
    const offered = await nearestWorkingPoints(brokenPointId, "CCS2");

    // Поиск §51.6 географический и смотрит на весь мир, а не на один набор
    // данных: другие наборы ставят свои пункты рядом с этими же
    // координатами. Поэтому проверяется порядок **своих** пунктов, а не то,
    // что в ответе больше никого нет.
    const mine = offered.filter((p) => [nearbyFreeId, farFreeId].includes(p.id));
    expect(mine.map((p) => p.id)).toEqual([nearbyFreeId, farFreeId]);
    expect(mine[0].distanceM).toBeLessThan(mine[1].distanceM!);
  });

  it("leaves out the busy one and the wrong plug", async () => {
    const offered = await nearestWorkingPoints(brokenPointId, "CCS2");
    expect(offered.map((p) => p.id)).not.toContain(nearbyBusyId);
    expect(offered.map((p) => p.name)).not.toContain("Wrong plug");
  });

  it("never offers the broken point itself", async () => {
    const offered = await nearestWorkingPoints(brokenPointId, "CCS2");
    expect(offered.map((p) => p.id)).not.toContain(brokenPointId);
  });

  it("offers at most three", async () => {
    const offered = await nearestWorkingPoints(brokenPointId, "CCS2");
    expect(offered.length).toBeLessThanOrEqual(3);
  });

  it("says nothing rather than guessing when the point has no coordinates", async () => {
    const nowhere = await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Nowhere", status: "PUBLISHED" },
    });
    expect(await nearestWorkingPoints(nowhere.id, "CCS2")).toEqual([]);
  });
});

describe("a double tap is one report", () => {
  it("returns the same ticket when a signed-in driver repeats within five minutes", async () => {
    const first = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });
    const again = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });
    expect(again.ticket.id).toBe(first.ticket.id);
    expect(await prisma.ticket.count({ where: { operatorId } })).toBe(1);
  });

  it("opens a new ticket after the window closed", async () => {
    const first = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });
    await prisma.ticket.update({
      where: { id: first.ticket.id },
      data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    const again = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });
    expect(again.ticket.id).not.toBe(first.ticket.id);
  });

  it("opens a new ticket for a different problem on the same point", async () => {
    const first = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
    });
    const other = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "WRONG_PRICE",
    });
    expect(other.ticket.id).not.toBe(first.ticket.id);
  });

  it("never glues two anonymous reports together: without a reporter there is no 'same person'", async () => {
    const first = await reportProblem({ pointId: brokenPointId, problemType: "BLOCKED" });
    const second = await reportProblem({ pointId: brokenPointId, problemType: "BLOCKED" });
    expect(second.ticket.id).not.toBe(first.ticket.id);
  });

  it("gives one ticket when two taps arrive at once", async () => {
    const [a, b] = await Promise.all([
      reportProblem({ pointId: brokenPointId, reporterId, problemType: "BLOCKED" }),
      reportProblem({ pointId: brokenPointId, reporterId, problemType: "BLOCKED" }),
    ]);
    expect(a.ticket.id).toBe(b.ticket.id);
    expect(await prisma.ticket.count({ where: { operatorId } })).toBe(1);
  });
});

describe("the conversation starts with the report", () => {
  it("keeps the customer's comment as the first message, so the thread reads from the start", async () => {
    const result = await reportProblem({
      pointId: brokenPointId,
      reporterId,
      problemType: "BLOCKED",
      comment: "Стоит фургон без зарядки",
    });
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: result.ticket.id },
      orderBy: { createdAt: "asc" },
    });
    expect(messages[0].authorKind).toBe("CUSTOMER");
    expect(messages[0].body).toContain("фургон");
    // Комментарий клиента не ответ поддержки: срок реакции §48 всё ещё идёт.
    expect(result.ticket.firstRespondedAt).toBeNull();
  });

  it("says in the thread that a work order was opened (US-54)", async () => {
    const result = await reportProblem({
      pointId: brokenPointId,
      connectorId: brokenConnectorId,
      reporterId,
      problemType: "DAMAGED_CABLE",
    });
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: result.ticket.id, authorKind: "SYSTEM" },
    });
    expect(messages).toHaveLength(1);
    expect(result.workOrder).not.toBeNull();
  });

  it("puts the photos on both the ticket and the work order (§51.4, §48)", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 1)]);
    const result = await reportProblem({
      pointId: brokenPointId,
      connectorId: brokenConnectorId,
      reporterId,
      problemType: "DAMAGED_CABLE",
      photos: [{ filename: "cable.jpg", bytes: jpeg }],
    });
    expect(result.ticket.photos).toHaveLength(1);
    expect(result.workOrder?.photos).toEqual(result.ticket.photos);
  });

  // §51.1 "кнопка доступна … в истории зарядок" — такая заявка называет сеанс,
  // и без этого «возврат ошибочного списания» не имеет предмета.
  describe("a report from the charge history", () => {
    it("keeps the session it came from", async () => {
      const payment = await seedPayment(walletId);
      const { ticket } = await reportProblem({
        pointId: brokenPointId,
        reporterId,
        problemType: "WRONG_PRICE",
        paymentId: payment.id,
      });
      expect(ticket.paymentId).toBe(payment.id);
    });

    it("two reports about one session and one problem are one ticket", async () => {
      const payment = await seedPayment(walletId);
      const first = await reportProblem({
        pointId: brokenPointId,
        reporterId,
        problemType: "WRONG_PRICE",
        paymentId: payment.id,
      });
      const second = await reportProblem({
        pointId: brokenPointId,
        reporterId,
        problemType: "WRONG_PRICE",
        paymentId: payment.id,
      });
      expect(second.ticket.id).toBe(first.ticket.id);
    });

    it("refuses a session that belongs to somebody else", async () => {
      const payment = await seedPayment(strangerWalletId);
      await expect(
        reportProblem({
          pointId: brokenPointId,
          reporterId,
          problemType: "WRONG_PRICE",
          paymentId: payment.id,
        }),
      ).rejects.toThrow(TicketError);
    });

    it("refuses a session on an anonymous report", async () => {
      const payment = await seedPayment(walletId);
      await expect(
        reportProblem({
          pointId: brokenPointId,
          reporterId: null,
          problemType: "WRONG_PRICE",
          paymentId: payment.id,
        }),
      ).rejects.toThrow(TicketError);
    });
  });
});
