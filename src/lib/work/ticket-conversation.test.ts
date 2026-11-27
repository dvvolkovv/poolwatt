// §51 «клиент видит статус заявки и переписывается с поддержкой в чате» и
// §48 «SLA по приоритету»: срок реакции считается по первому ответу
// человека, а не по наряду, который система открывает сама.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  TicketConversationError,
  closeTicket,
  postTicketMessage,
  resolveTicket,
  systemMessage,
} from "./ticket-conversation";

const PREFIX = "test_ticketconv_";

let operatorId: string;
let pointId: string;
let reporterUserId: string;
let supportUserId: string;
let ticketId: string;

async function wipe() {
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.ticket.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
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
      data: { username: `${PREFIX}reporter`, passwordHash: "x" },
    })
  ).id;
  supportUserId = (
    await prisma.user.create({
      data: { username: `${PREFIX}support`, passwordHash: "x" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Conversation network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Point" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

beforeEach(async () => {
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operatorId } },
  });
  await prisma.ticket.deleteMany({ where: { operatorId } });
  ticketId = (
    await prisma.ticket.create({
      data: {
        operatorId,
        pointId,
        reporterId: reporterUserId,
        problemType: "NO_START",
        respondBy: new Date(Date.now() + 30 * 60 * 1000),
      },
    })
  ).id;
});

describe("postTicketMessage", () => {
  it("keeps a customer's own message from moving the status", async () => {
    await postTicketMessage({
      ticketId,
      authorKind: "CUSTOMER",
      authorId: reporterUserId,
      body: "Кабель не защёлкивается",
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("OPEN");
    expect(ticket.firstRespondedAt).toBeNull();
  });

  it("stamps the SLA on the first answer by support and takes the ticket into work", async () => {
    await postTicketMessage({
      ticketId,
      authorKind: "SUPPORT",
      authorId: supportUserId,
      body: "Выехал инженер",
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("IN_PROGRESS");
    expect(ticket.firstRespondedAt).not.toBeNull();
  });

  it("does not move the stamp on the second answer", async () => {
    await postTicketMessage({
      ticketId,
      authorKind: "SUPPORT",
      authorId: supportUserId,
      body: "Первый",
    });
    const first = (await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }))
      .firstRespondedAt;
    await postTicketMessage({
      ticketId,
      authorKind: "SUPPORT",
      authorId: supportUserId,
      body: "Второй",
    });
    const again = (await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }))
      .firstRespondedAt;
    expect(again?.getTime()).toBe(first?.getTime());
  });

  it("refuses an empty message", async () => {
    await expect(
      postTicketMessage({
        ticketId,
        authorKind: "CUSTOMER",
        authorId: reporterUserId,
        body: "   ",
      }),
    ).rejects.toBeInstanceOf(TicketConversationError);
  });

  it("gives one stamp when two answers arrive at once", async () => {
    await Promise.all([
      postTicketMessage({
        ticketId,
        authorKind: "SUPPORT",
        authorId: supportUserId,
        body: "Один",
      }),
      postTicketMessage({
        ticketId,
        authorKind: "SUPPORT",
        authorId: supportUserId,
        body: "Два",
      }),
    ]);
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { messages: true },
    });
    expect(ticket.messages).toHaveLength(2);
    expect(ticket.firstRespondedAt).not.toBeNull();
    // Отметка — одна, и она от первого из двух.
    const earliest = Math.min(...ticket.messages.map((m) => m.createdAt.getTime()));
    expect(ticket.firstRespondedAt!.getTime()).toBeLessThanOrEqual(
      earliest + 2000,
    );
  });
});

describe("resolveTicket", () => {
  it("refuses to close a ticket without words", async () => {
    await expect(
      resolveTicket({ ticketId, authorId: supportUserId, body: "" }),
    ).rejects.toBeInstanceOf(TicketConversationError);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("OPEN");
  });

  it("resolves with words and leaves them in the conversation", async () => {
    await resolveTicket({
      ticketId,
      authorId: supportUserId,
      body: "Заменили кабель, станция работает",
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { messages: true },
    });
    expect(ticket.status).toBe("RESOLVED");
    expect(ticket.resolvedAt).not.toBeNull();
    expect(ticket.firstRespondedAt).not.toBeNull();
    expect(ticket.messages.at(-1)?.body).toContain("Заменили кабель");
  });

  it("lets the customer reopen a resolved ticket by writing in it", async () => {
    await resolveTicket({ ticketId, authorId: supportUserId, body: "Проверьте" });
    await postTicketMessage({
      ticketId,
      authorKind: "CUSTOMER",
      authorId: reporterUserId,
      body: "Всё ещё не работает",
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("IN_PROGRESS");
    expect(ticket.resolvedAt).toBeNull();
  });

  it("does not reopen on support's own follow-up", async () => {
    await resolveTicket({ ticketId, authorId: supportUserId, body: "Готово" });
    await postTicketMessage({
      ticketId,
      authorKind: "SUPPORT",
      authorId: supportUserId,
      body: "И ещё одно",
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("RESOLVED");
  });
});

describe("a closed ticket", () => {
  it("takes no message from anyone", async () => {
    await closeTicket(ticketId);
    await expect(
      postTicketMessage({
        ticketId,
        authorKind: "CUSTOMER",
        authorId: reporterUserId,
        body: "Ещё раз",
      }),
    ).rejects.toBeInstanceOf(TicketConversationError);
    await expect(
      postTicketMessage({
        ticketId,
        authorKind: "SUPPORT",
        authorId: supportUserId,
        body: "Ответ",
      }),
    ).rejects.toBeInstanceOf(TicketConversationError);
  });
});

describe("systemMessage", () => {
  it("writes a message with no author and does not touch the status", async () => {
    await systemMessage(prisma, ticketId, "Наряд открыт");
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { messages: true },
    });
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0].authorKind).toBe("SYSTEM");
    expect(ticket.messages[0].authorId).toBeNull();
    expect(ticket.status).toBe("OPEN");
    expect(ticket.firstRespondedAt).toBeNull();
  });

  it("speaks into a closed ticket, because the system reports facts", async () => {
    await closeTicket(ticketId);
    await systemMessage(prisma, ticketId, "Станция снова работает");
    const messages = await prisma.ticketMessage.findMany({ where: { ticketId } });
    expect(messages).toHaveLength(1);
  });
});
