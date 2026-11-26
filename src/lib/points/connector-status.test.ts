// §27 «история доступности». Занятость разъёма меняют пять мест; все они
// идут через одного писателя, и журнал ведёт он.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  LOG_KEEP_DAYS,
  purgeConnectorStatusLog,
  setConnectorStatus,
} from "./connector-status";

const SLUG = "test_connector_status_net";

let pointId: string;
let connectorId: string;

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

beforeAll(async () => {
  await wipe();
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "Connector status test net" },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "Status depot",
      status: "DRAFT",
      country: "SK",
      // Подальше от прямоугольников, которые просматривает point-search:
      // файлы набора идут параллельно по одной базе.
      latitude: 50.21,
      longitude: 22.37,
      paymentMethods: ["TOKEN"],
      connectors: { create: [{ type: "CCS2", powerKw: 150, quantity: 1, status: "UNKNOWN" }] },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0].id;
});

beforeEach(async () => {
  await prisma.connectorStatusLog.deleteMany({ where: { pointId } });
  await prisma.pointConnector.update({
    where: { id: connectorId },
    data: { status: "UNKNOWN", statusAt: null },
  });
});

afterAll(async () => {
  await wipe();
});

describe("setConnectorStatus", () => {
  it("writes the change down, with its source and its moment", async () => {
    const at = new Date("2026-11-20T10:00:00.000Z");
    const changed = await setConnectorStatus(prisma, connectorId, "FREE", "equipment", at);

    expect(changed).toBe(true);
    const rows = await prisma.connectorStatusLog.findMany({ where: { connectorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "FREE", source: "equipment", pointId });
    expect(rows[0].at.toISOString()).toBe(at.toISOString());

    const connector = await prisma.pointConnector.findUnique({ where: { id: connectorId } });
    expect(connector?.status).toBe("FREE");
    expect(connector?.statusAt?.toISOString()).toBe(at.toISOString());
  });

  it("says nothing when nothing changed", async () => {
    const first = new Date("2026-11-20T10:00:00.000Z");
    await setConnectorStatus(prisma, connectorId, "FREE", "equipment", first);

    // Оборудование отчитывается раз в минуту; «всё так же свободно» — не news.
    const again = await setConnectorStatus(
      prisma,
      connectorId,
      "FREE",
      "equipment",
      new Date("2026-11-20T10:01:00.000Z"),
    );

    expect(again).toBe(false);
    expect(await prisma.connectorStatusLog.count({ where: { connectorId } })).toBe(1);
    const connector = await prisma.pointConnector.findUnique({ where: { id: connectorId } });
    // Прежнее время смены остаётся: разъём свободен с десяти, не с 10:01.
    expect(connector?.statusAt?.toISOString()).toBe(first.toISOString());
  });

  it("keeps every source apart", async () => {
    await setConnectorStatus(prisma, connectorId, "FREE", "equipment");
    await setConnectorStatus(prisma, connectorId, "BOOKED", "booking");
    await setConnectorStatus(prisma, connectorId, "BUSY", "session-start");
    await setConnectorStatus(prisma, connectorId, "FREE", "session-end");
    await setConnectorStatus(prisma, connectorId, "OUT_OF_SERVICE", "ticket");

    const rows = await prisma.connectorStatusLog.findMany({
      where: { connectorId },
      orderBy: { at: "asc" },
    });
    expect(rows.map((r) => r.source)).toEqual([
      "equipment",
      "booking",
      "session-start",
      "session-end",
      "ticket",
    ]);
  });

  it("has nothing to say about a connector that is not there", async () => {
    expect(await setConnectorStatus(prisma, "no-such-connector", "FREE", "equipment")).toBe(
      false,
    );
  });

  it("works inside a transaction", async () => {
    await prisma.$transaction(async (tx) => {
      await setConnectorStatus(tx, connectorId, "BUSY", "session-start");
      // Внутри транзакции запись уже видна.
      expect(await tx.connectorStatusLog.count({ where: { connectorId } })).toBe(1);
    });
    expect(await prisma.connectorStatusLog.count({ where: { connectorId } })).toBe(1);
  });
});

describe("purgeConnectorStatusLog", () => {
  it("drops what is older than the keep window and leaves the rest", async () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    const old = new Date(now.getTime() - (LOG_KEEP_DAYS + 1) * 86_400_000);
    const fresh = new Date(now.getTime() - 86_400_000);
    await prisma.connectorStatusLog.createMany({
      data: [
        { connectorId, pointId, status: "FREE", at: old, source: "equipment" },
        { connectorId, pointId, status: "BUSY", at: fresh, source: "equipment" },
      ],
    });

    const removed = await purgeConnectorStatusLog(now);

    expect(removed).toBe(1);
    const left = await prisma.connectorStatusLog.findMany({ where: { connectorId } });
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("BUSY");
  });
});
