// US-51 — "Как руководитель развития, хочу видеть воронку новых пунктов:
// канбан по этапам с ответственными и сроками."
//
// §48 names the seven stages and says each one carries somebody answerable, a
// date, documents and comments. What belongs here is the board itself: whose
// leads they are, how a card moves, and the counting the funnel is for.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  LeadError,
  LEAD_STAGES,
  addLeadNote,
  createLead,
  deleteLead,
  markLeadLost,
  moveLead,
  readBoard,
  updateLead,
} from "./lead-service";

const PREFIX = "test_lead_";

let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let strangerUserId: string;
let employeeId: string;
let foreignEmployeeId: string;

async function wipe() {
  await prisma.leadNote.deleteMany({ where: { lead: { operator: { slug: { startsWith: PREFIX } } } } });
  await prisma.leadDocument.deleteMany({
    where: { lead: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.siteLead.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  strangerUserId = await user("stranger");
  const staffUserId = await user("staff");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Lead network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  const role = await prisma.staffRole.create({
    data: { operatorId, name: "Development", permissions: ["POINTS_EDIT"] },
  });
  employeeId = (
    await prisma.employee.create({
      data: { operatorId, userId: staffUserId, roleId: role.id },
    })
  ).id;

  const foreignRole = await prisma.staffRole.create({
    data: { operatorId: otherOperatorId, name: "Theirs", permissions: [] },
  });
  foreignEmployeeId = (
    await prisma.employee.create({
      data: { operatorId: otherOperatorId, userId: strangerUserId, roleId: foreignRole.id },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.siteLead.deleteMany({ where: { operatorId: { in: [operatorId, otherOperatorId] } } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const lead = (over: Record<string, unknown> = {}) =>
  createLead({
    operatorId,
    actorId: ownerUserId,
    title: "Supermarket car park",
    city: "Košice",
    country: "SK",
    ...over,
  });

describe("createLead — a place that might become a point", () => {
  it("starts at the first of §48's stages", async () => {
    const l = await lead();
    expect(l.stage).toBe("SCOUTING");
    expect(LEAD_STAGES[0]).toBe("SCOUTING");
    expect(l.createdById).toBe(ownerUserId);
  });

  it("takes an owner and a date, which is what the board is for", async () => {
    const due = new Date(Date.UTC(2026, 11, 1));
    const l = await lead({ ownerEmployeeId: employeeId, dueAt: due });

    expect(l.ownerEmployeeId).toBe(employeeId);
    expect(l.dueAt?.toISOString()).toBe(due.toISOString());
  });

  it("refuses an answerable person from another network", async () => {
    await expect(lead({ ownerEmployeeId: foreignEmployeeId })).rejects.toThrow(/network/i);
  });

  it("refuses a stranger", async () => {
    await expect(
      createLead({ operatorId, actorId: strangerUserId, title: "Theirs" }),
    ).rejects.toThrow(LeadError);
  });

  it("refuses a lead with no name", async () => {
    await expect(lead({ title: "  " })).rejects.toThrow(/name|title/i);
  });

  it("puts a new lead at the top of its column", async () => {
    const first = await lead({ title: "First" });
    const second = await lead({ title: "Second" });

    const board = await readBoard(operatorId, ownerUserId);
    const scouting = board.columns.find((c) => c.stage === "SCOUTING")!;
    expect(scouting.leads.map((l) => l.id)).toEqual([second.id, first.id]);
  });
});

describe("moveLead — dragging a card", () => {
  it("moves it to another stage", async () => {
    const l = await lead();
    const moved = await moveLead({ leadId: l.id, actorId: ownerUserId, stage: "CONTRACT" });

    expect(moved.stage).toBe("CONTRACT");
  });

  it("records the move, because a funnel is a history", async () => {
    const l = await lead();
    await moveLead({ leadId: l.id, actorId: ownerUserId, stage: "NEGOTIATION" });

    const log = await prisma.auditLog.findFirst({
      where: { entity: "SiteLead", entityId: l.id, action: "lead.moved" },
    });
    expect(log).not.toBeNull();
    expect((log!.after as { stage: string }).stage).toBe("NEGOTIATION");
  });

  it("can be dropped at a chosen place in the column", async () => {
    const a = await lead({ title: "A" });
    const b = await lead({ title: "B" });
    await moveLead({ leadId: a.id, actorId: ownerUserId, stage: "DESIGN" });
    await moveLead({ leadId: b.id, actorId: ownerUserId, stage: "DESIGN", position: 0 });

    const board = await readBoard(operatorId, ownerUserId);
    const design = board.columns.find((c) => c.stage === "DESIGN")!;
    expect(design.leads.map((l) => l.title)).toEqual(["B", "A"]);
  });

  it("refuses a stage that is not one of §48's", async () => {
    const l = await lead();
    await expect(
      moveLead({ leadId: l.id, actorId: ownerUserId, stage: "ABANDONED" as never }),
    ).rejects.toThrow(LeadError);
  });

  it("refuses somebody else's lead", async () => {
    const l = await lead();
    await expect(
      moveLead({ leadId: l.id, actorId: strangerUserId, stage: "CONTRACT" }),
    ).rejects.toThrow(LeadError);
  });
});

describe("markLeadLost — a funnel without its losses measures nothing", () => {
  it("keeps the card with its reason", async () => {
    const l = await lead();
    const lost = await markLeadLost({
      leadId: l.id,
      actorId: ownerUserId,
      reason: "The landlord let it to a supermarket",
    });

    expect(lost.lostAt).not.toBeNull();
    expect(lost.lostReason).toMatch(/landlord/);
  });

  it("asks for a reason", async () => {
    const l = await lead();
    await expect(
      markLeadLost({ leadId: l.id, actorId: ownerUserId, reason: "  " }),
    ).rejects.toThrow(/reason/i);
  });

  it("takes a lost lead off the board but keeps it in the count", async () => {
    const kept = await lead({ title: "Alive" });
    const gone = await lead({ title: "Gone" });
    await markLeadLost({ leadId: gone.id, actorId: ownerUserId, reason: "Too far from the grid" });

    const board = await readBoard(operatorId, ownerUserId);
    const scouting = board.columns.find((c) => c.stage === "SCOUTING")!;
    expect(scouting.leads.map((l) => l.id)).toEqual([kept.id]);
    expect(board.lost).toHaveLength(1);
    expect(board.totals.lost).toBe(1);
  });
});

describe("readBoard — §48's seven columns", () => {
  it("always shows every stage, even the empty ones", async () => {
    const board = await readBoard(operatorId, ownerUserId);
    expect(board.columns.map((c) => c.stage)).toEqual([...LEAD_STAGES]);
  });

  it("counts what is in flight and what is overdue", async () => {
    await lead({ title: "On time", dueAt: new Date(Date.now() + 7 * 86_400_000) });
    await lead({ title: "Late", dueAt: new Date(Date.now() - 86_400_000) });
    await lead({ title: "No date" });

    const board = await readBoard(operatorId, ownerUserId);
    expect(board.totals.open).toBe(3);
    expect(board.totals.overdue).toBe(1);
  });

  it("marks the overdue card itself, so the board shows it", async () => {
    const late = await lead({ dueAt: new Date(Date.now() - 86_400_000) });
    const board = await readBoard(operatorId, ownerUserId);
    const card = board.columns
      .flatMap((c) => c.leads)
      .find((l) => l.id === late.id)!;
    expect(card.overdue).toBe(true);
  });

  it("names the person answerable on each card", async () => {
    await lead({ ownerEmployeeId: employeeId });
    const board = await readBoard(operatorId, ownerUserId);
    const card = board.columns.flatMap((c) => c.leads)[0];
    expect(card.ownerName).toBe(`${PREFIX}staff`);
  });

  it("says nothing about another network's board", async () => {
    await lead();
    await expect(readBoard(operatorId, strangerUserId)).rejects.toThrow(LeadError);
  });
});

describe("notes and editing", () => {
  it("keeps comments in the order they were written", async () => {
    const l = await lead();
    await addLeadNote({ leadId: l.id, actorId: ownerUserId, text: "Called the owner" });
    await addLeadNote({ leadId: l.id, actorId: ownerUserId, text: "They want a meeting" });

    const notes = await prisma.leadNote.findMany({
      where: { leadId: l.id },
      orderBy: { createdAt: "asc" },
    });
    expect(notes.map((n) => n.text)).toEqual(["Called the owner", "They want a meeting"]);
  });

  it("refuses an empty comment", async () => {
    const l = await lead();
    await expect(
      addLeadNote({ leadId: l.id, actorId: ownerUserId, text: "   " }),
    ).rejects.toThrow(LeadError);
  });

  it("changes the owner and the date", async () => {
    const l = await lead();
    const due = new Date(Date.UTC(2027, 0, 15));
    const updated = await updateLead({
      leadId: l.id,
      actorId: ownerUserId,
      ownerEmployeeId: employeeId,
      dueAt: due,
      addressLine: "Hlavná 7",
    });

    expect(updated.ownerEmployeeId).toBe(employeeId);
    expect(updated.dueAt?.toISOString()).toBe(due.toISOString());
    expect(updated.addressLine).toBe("Hlavná 7");
  });

  it("deletes a lead with everything written on it", async () => {
    const l = await lead();
    await addLeadNote({ leadId: l.id, actorId: ownerUserId, text: "note" });
    await deleteLead(l.id, ownerUserId);

    expect(await prisma.siteLead.findUnique({ where: { id: l.id } })).toBeNull();
    expect(await prisma.leadNote.count({ where: { leadId: l.id } })).toBe(0);
  });
});
