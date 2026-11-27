// §51 «после ремонта клиент получает уведомление, что станция снова
// работает». До этой работы не было ни уведомления, ни места, где клиент мог
// бы это увидеть.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { closeTicket } from "./ticket-conversation";
import { notifyRecoveredTickets } from "./ticket-recovery";

const PREFIX = "test_ticketrec_";

let operatorId: string;
let pointId: string;
let connectorId: string;
let reporterUserId: string;
let silentReporterId: string;

async function wipe() {
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.ticket.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  reporterUserId = (
    await prisma.user.create({
      data: {
        username: `${PREFIX}driver`,
        passwordHash: "x",
        email: `${PREFIX}driver@example.test`,
        emailVerified: new Date(),
      },
    })
  ).id;
  silentReporterId = (
    await prisma.user.create({ data: { username: `${PREFIX}silent`, passwordHash: "x" } })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Recovery network" },
    })
  ).id;
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "Recovery point",
      connectors: {
        create: [
          {
            type: "CCS2",
            powerKw: new Prisma.Decimal(50),
            currentAc: false,
            quantity: 1,
            status: "OUT_OF_SERVICE",
          },
        ],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0].id;
});

afterAll(async () => {
  await wipe();
});

beforeEach(async () => {
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operatorId } } });
  await prisma.ticket.deleteMany({ where: { operatorId } });
  await prisma.pointConnector.update({
    where: { id: connectorId },
    data: { status: "OUT_OF_SERVICE" },
  });
});

async function brokenTicket(overrides: Record<string, unknown> = {}) {
  return prisma.ticket.create({
    data: {
      operatorId,
      pointId,
      connectorId,
      reporterId: reporterUserId,
      problemType: "DAMAGED_CABLE",
      status: "IN_PROGRESS",
      ...overrides,
    },
  });
}

async function repair() {
  await prisma.pointConnector.update({
    where: { id: connectorId },
    data: { status: "FREE" },
  });
}

describe("notifyRecoveredTickets", () => {
  it("tells the reporter once that the station works again", async () => {
    const ticket = await brokenTicket();
    await repair();
    const sent: string[] = [];
    const told = await notifyRecoveredTickets(new Date(), {
      sendTo: async (to) => {
        sent.push(to);
      },
    });

    expect(told).toBe(1);
    expect(sent).toEqual([`${PREFIX}driver@example.test`]);
    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { messages: true },
    });
    expect(after.recoveryNotifiedAt).not.toBeNull();
    expect(after.messages.filter((m) => m.authorKind === "SYSTEM")).toHaveLength(1);

    expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("says nothing while the connector is still out of service", async () => {
    await brokenTicket();
    expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("says nothing about a ticket with no connector: we do not know what was fixed", async () => {
    await brokenTicket({ connectorId: null });
    await repair();
    expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("says nothing about a report that was never a breakdown", async () => {
    await brokenTicket({ problemType: "WRONG_PRICE" });
    await repair();
    expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("says nothing on a ticket that has already been closed", async () => {
    const ticket = await brokenTicket();
    await closeTicket(ticket.id);
    await repair();
    expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("still writes the message when the reporter has no verified email", async () => {
    const ticket = await brokenTicket({ reporterId: silentReporterId });
    await repair();
    const sent: string[] = [];
    expect(
      await notifyRecoveredTickets(new Date(), {
        sendTo: async (to) => {
          sent.push(to);
        },
      }),
    ).toBe(1);
    expect(sent).toEqual([]);
    const messages = await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id } });
    expect(messages).toHaveLength(1);
  });

  it("says nothing about an anonymous report: there is nobody to tell", async () => {
    await brokenTicket({ reporterId: null });
    await repair();
    expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });
});
