// §27 «Полная карточка: … история доступности». Семь дней по каждому
// разъёму: сколько времени он был свободен.
//
// День, о котором журнал молчит, получает null, а не ноль: «мы не знаем» —
// это не «не был свободен». То же правило, по которому фильтр «свободен
// сейчас» не считает свободным разъём, о котором нам не докладывали.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { HISTORY_DAYS, readAvailabilityHistory } from "./availability-history";

const SLUG = "test_avail_history_net";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const DAY = 86_400_000;

let pointId: string;
let connectorId: string;

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

async function logAt(status: string, at: Date, source = "equipment") {
  await prisma.connectorStatusLog.create({
    data: { connectorId, pointId, status: status as never, at, source },
  });
}

beforeAll(async () => {
  await wipe();
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "Availability history test net" },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "History depot",
      status: "DRAFT",
      country: "SK",
      latitude: 50.31,
      longitude: 22.41,
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
});

afterAll(async () => {
  await wipe();
});

describe("readAvailabilityHistory", () => {
  it("covers seven days, the last one cut at now", async () => {
    const history = await readAvailabilityHistory(pointId, NOW);
    expect(history).toHaveLength(1);
    expect(history[0].days).toHaveLength(HISTORY_DAYS);
    expect(history[0].days[HISTORY_DAYS - 1].day).toBe("2026-11-26");
    expect(history[0].days[0].day).toBe("2026-11-20");
  });

  it("knows nothing about a day the log never mentions", async () => {
    const history = await readAvailabilityHistory(pointId, NOW);
    expect(history[0].days.every((d) => d.freeShare === null)).toBe(true);
    expect(history[0].lastChange).toBeNull();
  });

  it("counts a whole day of being free as one", async () => {
    // Освободился задолго до окна и больше не менялся.
    await logAt("FREE", new Date("2026-11-10T08:00:00.000Z"));

    const history = await readAvailabilityHistory(pointId, NOW);
    expect(history[0].days[0].freeShare).toBeCloseTo(1, 5);
    // Последние сутки обрезаны полуднем, но доля всё равно единица.
    expect(history[0].days[HISTORY_DAYS - 1].freeShare).toBeCloseTo(1, 5);
  });

  it("counts half a day when it freed up at noon", async () => {
    await logAt("BUSY", new Date("2026-11-10T08:00:00.000Z"));
    await logAt("FREE", new Date("2026-11-22T12:00:00.000Z"));

    const history = await readAvailabilityHistory(pointId, NOW);
    const nov22 = history[0].days.find((d) => d.day === "2026-11-22");
    expect(nov22?.freeShare).toBeCloseTo(0.5, 5);
    // До этого был занят весь день, после — свободен весь день.
    expect(history[0].days.find((d) => d.day === "2026-11-21")?.freeShare).toBeCloseTo(0, 5);
    expect(history[0].days.find((d) => d.day === "2026-11-23")?.freeShare).toBeCloseTo(1, 5);
  });

  it("carries the state in from the last record before the window", async () => {
    // Единственная запись — до окна. Все семь дней должны знать про неё.
    await logAt("FREE", new Date("2026-10-01T00:00:00.000Z"));
    const history = await readAvailabilityHistory(pointId, NOW);
    expect(history[0].days.every((d) => d.freeShare === 1)).toBe(true);
  });

  it("reports the last change with its moment", async () => {
    await logAt("FREE", new Date("2026-11-24T08:00:00.000Z"));
    const last = new Date("2026-11-25T09:30:00.000Z");
    await logAt("OUT_OF_SERVICE", last, "ticket");

    const history = await readAvailabilityHistory(pointId, NOW);
    expect(history[0].lastChange).toEqual({
      status: "OUT_OF_SERVICE",
      at: last.toISOString(),
      source: "ticket",
    });
    // Не работает — значит не свободен.
    expect(history[0].days.find((d) => d.day === "2026-11-26")?.freeShare).toBeCloseTo(0, 5);
  });

  it("counts a booked connector as not free: the place is promised away", async () => {
    await logAt("BOOKED", new Date("2026-11-19T00:00:00.000Z"), "booking");
    const history = await readAvailabilityHistory(pointId, NOW);
    expect(history[0].days.every((d) => d.freeShare === 0)).toBe(true);
  });

  it("has nothing to say about a point that is not there", async () => {
    expect(await readAvailabilityHistory("no-such-point", NOW)).toEqual([]);
  });
});
