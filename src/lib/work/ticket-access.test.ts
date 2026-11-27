// §51 + §47 — кто может читать заявку и кто может в ней писать.
//
// Право `tickets.write` объявлено в §47 у ролей ADMIN и SUPPORT и до этой
// работы не проверялось ни одной строкой кода: у заявки не было ни одного
// действия. Здесь оно начинает что-то значить.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInRoles } from "@/lib/staff/staff-service";
import { readTicketForUser } from "./ticket-access";

const PREFIX = "test_ticketacc_";

let operatorId: string;
let ownerUserId: string;
let supportUserId: string;
let scopedSupportUserId: string;
let viewerUserId: string;
let engineerUserId: string;
let reporterUserId: string;
let strangerUserId: string;
let adminUserId: string;
let pointA: string;
let pointB: string;
let ticketA: string;
let ticketB: string;
let anonTicket: string;

async function wipe() {
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.ticket.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.employee.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.staffRole.deleteMany({
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
  const user = async (name: string, role?: "ADMIN") =>
    (
      await prisma.user.create({
        data: { username: `${PREFIX}${name}`, passwordHash: "x", ...(role ? { role } : {}) },
      })
    ).id;
  ownerUserId = await user("owner");
  supportUserId = await user("support");
  scopedSupportUserId = await user("scopedsupport");
  viewerUserId = await user("viewer");
  engineerUserId = await user("engineer");
  reporterUserId = await user("reporter");
  strangerUserId = await user("stranger");
  adminUserId = await user("admin", "ADMIN");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Ticket network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A" },
    })
  ).id;
  pointB = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "B" },
    })
  ).id;

  const roles = await ensureBuiltInRoles(operatorId);
  const role = (name: string) => roles.find((r) => r.name === name)!.id;
  await prisma.employee.create({
    data: { operatorId, userId: supportUserId, roleId: role("SUPPORT"), pointIds: [] },
  });
  await prisma.employee.create({
    data: { operatorId, userId: scopedSupportUserId, roleId: role("SUPPORT"), pointIds: [pointA] },
  });
  await prisma.employee.create({
    data: { operatorId, userId: viewerUserId, roleId: role("VIEWER"), pointIds: [] },
  });
  await prisma.employee.create({
    data: { operatorId, userId: engineerUserId, roleId: role("ENGINEER"), pointIds: [] },
  });

  ticketA = (
    await prisma.ticket.create({
      data: { operatorId, pointId: pointA, reporterId: reporterUserId, problemType: "NO_START" },
    })
  ).id;
  ticketB = (
    await prisma.ticket.create({
      data: { operatorId, pointId: pointB, reporterId: reporterUserId, problemType: "BLOCKED" },
    })
  ).id;
  anonTicket = (
    await prisma.ticket.create({
      data: { operatorId, pointId: pointA, problemType: "OTHER" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

describe("readTicketForUser", () => {
  it("lets the reporter read and write their own ticket", async () => {
    const seen = await readTicketForUser(ticketA, reporterUserId, "USER");
    expect(seen?.canRead).toBe(true);
    expect(seen?.canWrite).toBe(true);
    expect(seen?.authorKind).toBe("CUSTOMER");
  });

  it("gives a stranger nothing at all", async () => {
    expect(await readTicketForUser(ticketA, strangerUserId, "USER")).toBeNull();
  });

  it("lets support read and answer", async () => {
    const seen = await readTicketForUser(ticketA, supportUserId, "USER");
    expect(seen?.canRead).toBe(true);
    expect(seen?.canWrite).toBe(true);
    expect(seen?.authorKind).toBe("SUPPORT");
  });

  it("lets a viewer read but never answer", async () => {
    const seen = await readTicketForUser(ticketA, viewerUserId, "USER");
    expect(seen?.canRead).toBe(true);
    expect(seen?.canWrite).toBe(false);
  });

  it("hides a point outside the employee's scope (§47)", async () => {
    expect(await readTicketForUser(ticketA, scopedSupportUserId, "USER")).not.toBeNull();
    expect(await readTicketForUser(ticketB, scopedSupportUserId, "USER")).toBeNull();
  });

  it("gives an engineer nothing: the broken cable is their business, the conversation is not", async () => {
    expect(await readTicketForUser(ticketA, engineerUserId, "USER")).toBeNull();
  });

  it("lets the network owner read and answer", async () => {
    const seen = await readTicketForUser(ticketA, ownerUserId, "USER");
    expect(seen?.canWrite).toBe(true);
    expect(seen?.authorKind).toBe("SUPPORT");
  });

  it("lets the Poolwatt operator read and answer", async () => {
    const seen = await readTicketForUser(ticketA, adminUserId, "ADMIN");
    expect(seen?.canWrite).toBe(true);
    expect(seen?.authorKind).toBe("SUPPORT");
  });

  it("shows an anonymous ticket to the network but to no customer", async () => {
    expect(await readTicketForUser(anonTicket, supportUserId, "USER")).not.toBeNull();
    expect(await readTicketForUser(anonTicket, reporterUserId, "USER")).toBeNull();
  });

  it("answers null for a ticket that does not exist", async () => {
    expect(await readTicketForUser("nope", reporterUserId, "USER")).toBeNull();
  });
});
