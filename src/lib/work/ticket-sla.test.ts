// §48 «SLA по приоритету; эскалация».
//
// Срок ответа ставился в заявку с самого US-52 и до этой работы его не читал
// никто: он существовал как строка в списке очереди.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { postTicketMessage, resolveTicket } from "./ticket-conversation";
import { RESOLVED_CLOSE_DAYS, closeResolvedTickets, escalateOverdueTickets } from "./ticket-sla";

const PREFIX = "test_ticketsla_";

let operatorId: string;
let pointId: string;
let ownerUserId: string;
let supportUserId: string;
let reporterUserId: string;

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
  ownerUserId = (
    await prisma.user.create({
      data: {
        username: `${PREFIX}owner`,
        passwordHash: "x",
        email: `${PREFIX}owner@example.test`,
        emailVerified: new Date(),
      },
    })
  ).id;
  supportUserId = (
    await prisma.user.create({ data: { username: `${PREFIX}support`, passwordHash: "x" } })
  ).id;
  reporterUserId = (
    await prisma.user.create({ data: { username: `${PREFIX}reporter`, passwordHash: "x" } })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "SLA network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "SLA point" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

beforeEach(async () => {
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operatorId } } });
  await prisma.ticket.deleteMany({ where: { operatorId } });
});

async function overdueTicket(overrides: Record<string, unknown> = {}) {
  return prisma.ticket.create({
    data: {
      operatorId,
      pointId,
      reporterId: reporterUserId,
      problemType: "NO_START",
      priority: "NORMAL",
      respondBy: new Date(Date.now() - 60 * 1000),
      ...overrides,
    },
  });
}

describe("escalateOverdueTickets", () => {
  it("raises an unanswered overdue ticket one step and tells the network", async () => {
    const ticket = await overdueTicket();
    const sent: string[] = [];
    const raised = await escalateOverdueTickets(new Date(), {
      sendTo: async (to) => {
        sent.push(to);
      },
    });

    expect(raised).toBe(1);
    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { messages: true },
    });
    expect(after.priority).toBe("HIGH");
    expect(after.escalatedAt).not.toBeNull();
    expect(after.messages.some((m) => m.authorKind === "SYSTEM")).toBe(true);
    expect(sent).toContain(`${PREFIX}owner@example.test`);
  });

  it("escalates once and then stays quiet", async () => {
    await overdueTicket();
    await escalateOverdueTickets(new Date(), { sendTo: async () => undefined });
    const again = await escalateOverdueTickets(new Date(), { sendTo: async () => undefined });
    expect(again).toBe(0);
  });

  it("leaves a ticket alone while the clock is still running", async () => {
    await overdueTicket({ respondBy: new Date(Date.now() + 30 * 60 * 1000) });
    expect(await escalateOverdueTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("never escalates a ticket support already answered", async () => {
    const ticket = await overdueTicket();
    await postTicketMessage({
      ticketId: ticket.id,
      authorKind: "SUPPORT",
      authorId: supportUserId,
      body: "Уже смотрим",
    });
    expect(await escalateOverdueTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });

  it("does not escalate on the customer's own nudge: the clock measures our answer", async () => {
    const ticket = await overdueTicket();
    await postTicketMessage({
      ticketId: ticket.id,
      authorKind: "CUSTOMER",
      authorId: reporterUserId,
      body: "Есть кто?",
    });
    expect(await escalateOverdueTickets(new Date(), { sendTo: async () => undefined })).toBe(1);
  });

  it("keeps URGENT at URGENT: there is nothing above it", async () => {
    const ticket = await overdueTicket({ priority: "URGENT" });
    await escalateOverdueTickets(new Date(), { sendTo: async () => undefined });
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.priority).toBe("URGENT");
    expect(after.escalatedAt).not.toBeNull();
  });

  it("does not lower the priority when the late answer finally arrives", async () => {
    const ticket = await overdueTicket();
    await escalateOverdueTickets(new Date(), { sendTo: async () => undefined });
    await postTicketMessage({
      ticketId: ticket.id,
      authorKind: "SUPPORT",
      authorId: supportUserId,
      body: "Простите за задержку",
    });
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.priority).toBe("HIGH");
    expect(after.escalatedAt).not.toBeNull();
  });

  it("leaves a closed ticket out of it", async () => {
    await overdueTicket({ status: "CLOSED", closedAt: new Date() });
    expect(await escalateOverdueTickets(new Date(), { sendTo: async () => undefined })).toBe(0);
  });
});

describe("closeResolvedTickets", () => {
  it(`closes what has been resolved for ${RESOLVED_CLOSE_DAYS} days`, async () => {
    const ticket = await overdueTicket();
    await resolveTicket({ ticketId: ticket.id, authorId: supportUserId, body: "Готово" });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { resolvedAt: new Date(Date.now() - (RESOLVED_CLOSE_DAYS + 1) * 86_400_000) },
    });

    expect(await closeResolvedTickets()).toBe(1);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe("CLOSED");
    expect(after.closedAt).not.toBeNull();
  });

  it("leaves a freshly resolved ticket open to an argument", async () => {
    const ticket = await overdueTicket();
    await resolveTicket({ ticketId: ticket.id, authorId: supportUserId, body: "Готово" });
    expect(await closeResolvedTickets()).toBe(0);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe("RESOLVED");
  });
});
