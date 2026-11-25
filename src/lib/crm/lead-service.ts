// §48 "Воронка развития сети" / US-51 — the board a development manager reads.
//
// The seven stages are §48's own, in §48's order. Two things are deliberate:
//
//   A lost lead keeps its card and its reason. A funnel that quietly deletes
//   what it failed at measures nothing — the whole point of the board is the
//   ratio between the columns.
//
//   The person answerable is an `Employee` of the network, not a free-text
//   name, so §47's scope rules already apply to them and a leaver stops being
//   answerable for anything by leaving.

import type { LeadStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";

export class LeadError extends Error {}

/** §48's stages, in §48's order. The board renders them exactly like this. */
export const LEAD_STAGES = [
  "SCOUTING",
  "NEGOTIATION",
  "CONTRACT",
  "DESIGN",
  "INSTALLATION",
  "COMMISSIONING",
  "PUBLISHED",
] as const satisfies readonly LeadStage[];

async function requireNetwork(operatorId: string, userId: string) {
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true },
  });
  if (!op) throw new LeadError("No such network");
  if (!op.claimedById || op.claimedById !== userId) {
    throw new LeadError("This network belongs to somebody else");
  }
  return op;
}

async function requireOwnedLead(leadId: string, userId: string) {
  const lead = await prisma.siteLead.findUnique({
    where: { id: leadId },
    include: { operator: { select: { claimedById: true } } },
  });
  if (!lead) throw new LeadError("No such lead");
  if (lead.operator.claimedById !== userId) {
    throw new LeadError("This lead belongs to somebody else");
  }
  return lead;
}

/**
 * Put one card at `index` in its column and renumber the rest.
 *
 * A kanban board only makes sense if "position 0" means the top, so the
 * numbers are the real order rather than a counter that drifts: dropping a
 * card renumbers the column it landed in, which is a handful of rows.
 */
async function placeInColumn(
  tx: Prisma.TransactionClient,
  args: { operatorId: string; stage: LeadStage; leadId: string; index: number },
): Promise<void> {
  const others = await tx.siteLead.findMany({
    where: { operatorId: args.operatorId, stage: args.stage, id: { not: args.leadId } },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    select: { id: true },
  });

  const order = others.map((o) => o.id);
  const at = Math.max(0, Math.min(args.index, order.length));
  order.splice(at, 0, args.leadId);

  for (const [position, id] of order.entries()) {
    await tx.siteLead.update({ where: { id }, data: { position } });
  }
}

/** An answerable person has to be of this network (§47). */
async function checkEmployee(operatorId: string, employeeId: string | null | undefined) {
  if (!employeeId) return;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { operatorId: true },
  });
  if (!employee || employee.operatorId !== operatorId) {
    throw new LeadError("That person is not an employee of this network");
  }
}

export interface LeadInput {
  operatorId: string;
  actorId: string;
  title: string;
  country?: string | null;
  city?: string | null;
  addressLine?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ownerEmployeeId?: string | null;
  dueAt?: Date | null;
}

export async function createLead(input: LeadInput) {
  await requireNetwork(input.operatorId, input.actorId);
  if (!input.title?.trim()) throw new LeadError("A lead needs a name");
  await checkEmployee(input.operatorId, input.ownerEmployeeId);

  return prisma.$transaction(async (tx) => {
    const lead = await tx.siteLead.create({
      data: {
        operatorId: input.operatorId,
        title: input.title.trim(),
        country: input.country?.trim() || null,
        city: input.city?.trim() || null,
        addressLine: input.addressLine?.trim() || null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        dueAt: input.dueAt ?? null,
        createdById: input.actorId,
      },
    });

    // A new card goes to the top of its column: it is the one somebody is
    // thinking about right now.
    await placeInColumn(tx, {
      operatorId: input.operatorId,
      stage: "SCOUTING",
      leadId: lead.id,
      index: 0,
    });

    return { ...lead, position: 0 };
  });
}

export async function updateLead(input: {
  leadId: string;
  actorId: string;
  title?: string;
  country?: string | null;
  city?: string | null;
  addressLine?: string | null;
  ownerEmployeeId?: string | null;
  dueAt?: Date | null;
}) {
  const lead = await requireOwnedLead(input.leadId, input.actorId);
  if (input.title !== undefined && !input.title.trim()) {
    throw new LeadError("A lead needs a name");
  }
  if (input.ownerEmployeeId !== undefined) {
    await checkEmployee(lead.operatorId, input.ownerEmployeeId);
  }

  const data: Prisma.SiteLeadUncheckedUpdateInput = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.country !== undefined) data.country = input.country?.trim() || null;
  if (input.city !== undefined) data.city = input.city?.trim() || null;
  if (input.addressLine !== undefined) data.addressLine = input.addressLine?.trim() || null;
  if (input.ownerEmployeeId !== undefined) data.ownerEmployeeId = input.ownerEmployeeId;
  if (input.dueAt !== undefined) data.dueAt = input.dueAt;

  return prisma.siteLead.update({ where: { id: input.leadId }, data });
}

export async function moveLead(input: {
  leadId: string;
  actorId: string;
  stage: LeadStage;
  /** Where in the column; omitted means the top. */
  position?: number;
}) {
  const lead = await requireOwnedLead(input.leadId, input.actorId);
  if (!(LEAD_STAGES as readonly string[]).includes(input.stage)) {
    throw new LeadError(`"${input.stage}" is not one of the stages of §48`);
  }

  // No index given means the top of the column.
  const index = input.position ?? 0;

  const moved = await prisma.$transaction(async (tx) => {
    const updated = await tx.siteLead.update({
      where: { id: input.leadId },
      data: { stage: input.stage },
    });
    await placeInColumn(tx, {
      operatorId: lead.operatorId,
      stage: input.stage,
      leadId: lead.id,
      index,
    });
    return updated;
  });

  // A funnel is a history: without the moves there is nothing to measure how
  // long a stage takes.
  await writeAudit(prisma, {
    actor: input.actorId,
    entity: "SiteLead",
    entityId: lead.id,
    action: "lead.moved",
    before: { stage: lead.stage },
    after: { stage: moved.stage, position: index },
  });

  return moved;
}

export async function markLeadLost(input: {
  leadId: string;
  actorId: string;
  reason: string;
}) {
  const lead = await requireOwnedLead(input.leadId, input.actorId);
  if (!input.reason?.trim()) {
    throw new LeadError("Say why it was lost: a funnel without reasons teaches nothing");
  }

  const lost = await prisma.siteLead.update({
    where: { id: lead.id },
    data: { lostAt: new Date(), lostReason: input.reason.trim() },
  });

  await writeAudit(prisma, {
    actor: input.actorId,
    entity: "SiteLead",
    entityId: lead.id,
    action: "lead.lost",
    after: { stage: lead.stage, reason: lost.lostReason },
  });

  return lost;
}

/** Back onto the board — a landlord who changed their mind again. */
export async function reopenLead(leadId: string, actorId: string) {
  const lead = await requireOwnedLead(leadId, actorId);
  return prisma.siteLead.update({
    where: { id: lead.id },
    data: { lostAt: null, lostReason: null },
  });
}

export async function addLeadNote(input: { leadId: string; actorId: string; text: string }) {
  await requireOwnedLead(input.leadId, input.actorId);
  if (!input.text?.trim()) throw new LeadError("An empty comment is not a comment");

  return prisma.leadNote.create({
    data: { leadId: input.leadId, authorId: input.actorId, text: input.text.trim() },
  });
}

export async function deleteLead(leadId: string, actorId: string): Promise<void> {
  await requireOwnedLead(leadId, actorId);
  await prisma.siteLead.delete({ where: { id: leadId } });
}

export interface LeadCard {
  id: string;
  title: string;
  city: string | null;
  country: string | null;
  addressLine: string | null;
  stage: LeadStage;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueAt: Date | null;
  /** Past its date and still not finished — the thing the board is read for. */
  overdue: boolean;
  noteCount: number;
  documentCount: number;
  pointId: string | null;
  lostAt: Date | null;
  lostReason: string | null;
  updatedAt: Date;
}

export interface LeadBoard {
  columns: { stage: LeadStage; leads: LeadCard[] }[];
  lost: LeadCard[];
  totals: { open: number; overdue: number; lost: number; published: number };
}

export async function readBoard(
  operatorId: string,
  userId: string,
  now = new Date(),
): Promise<LeadBoard> {
  await requireNetwork(operatorId, userId);

  const leads = await prisma.siteLead.findMany({
    where: { operatorId },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    include: {
      ownerEmployee: { include: { user: { select: { username: true, name: true } } } },
      _count: { select: { notes: true, documents: true } },
    },
  });

  const toCard = (l: (typeof leads)[number]): LeadCard => ({
    id: l.id,
    title: l.title,
    city: l.city,
    country: l.country,
    addressLine: l.addressLine,
    stage: l.stage,
    ownerEmployeeId: l.ownerEmployeeId,
    ownerName: l.ownerEmployee
      ? (l.ownerEmployee.user.name ?? l.ownerEmployee.user.username)
      : null,
    dueAt: l.dueAt,
    // A published lead is finished, however late it got there.
    overdue:
      l.lostAt == null &&
      l.stage !== "PUBLISHED" &&
      l.dueAt != null &&
      l.dueAt.getTime() < now.getTime(),
    noteCount: l._count.notes,
    documentCount: l._count.documents,
    pointId: l.pointId,
    lostAt: l.lostAt,
    lostReason: l.lostReason,
    updatedAt: l.updatedAt,
  });

  const cards = leads.map(toCard);
  const live = cards.filter((c) => c.lostAt == null);
  const lost = cards.filter((c) => c.lostAt != null);

  return {
    columns: LEAD_STAGES.map((stage) => ({
      stage,
      leads: live.filter((c) => c.stage === stage),
    })),
    lost,
    totals: {
      open: live.filter((c) => c.stage !== "PUBLISHED").length,
      overdue: live.filter((c) => c.overdue).length,
      lost: lost.length,
      published: live.filter((c) => c.stage === "PUBLISHED").length,
    },
  };
}

/** §48 "документы" — attach one to a lead. */
export async function attachLeadDocument(input: {
  leadId: string;
  actorId: string;
  filename: string;
  bytes: Buffer;
}) {
  await requireOwnedLead(input.leadId, input.actorId);
  const { saveLeadDoc } = await import("./lead-docs");
  const saved = await saveLeadDoc({
    leadId: input.leadId,
    filename: input.filename,
    bytes: input.bytes,
  });

  return prisma.leadDocument.create({
    data: {
      leadId: input.leadId,
      name: saved.name,
      storageKey: saved.storageKey,
      contentType: saved.contentType,
      sizeBytes: saved.sizeBytes,
      uploadedById: input.actorId,
    },
  });
}

export type FetchLeadDocResult =
  | { status: "ok"; bytes: Buffer; mime: string; name: string }
  | { status: "not-found" };

/** The bytes of a lead's document, to the network that owns the lead. */
export async function fetchLeadDocument(args: {
  documentId: string;
  userId: string | null;
  isAdmin: boolean;
}): Promise<FetchLeadDocResult> {
  const doc = await prisma.leadDocument.findUnique({
    where: { id: args.documentId },
    include: { lead: { include: { operator: { select: { claimedById: true } } } } },
  });
  if (!doc) return { status: "not-found" };

  const mayRead =
    args.isAdmin || (args.userId != null && doc.lead.operator.claimedById === args.userId);
  // A lease is not a public file: somebody else's lead does not exist.
  if (!mayRead) return { status: "not-found" };

  const { readLeadDoc } = await import("./lead-docs");
  const file = await readLeadDoc(doc.storageKey);
  if (!file) return { status: "not-found" };
  return { status: "ok", bytes: file.bytes, mime: doc.contentType, name: doc.name };
}

export async function detachLeadDocument(documentId: string, actorId: string): Promise<void> {
  const doc = await prisma.leadDocument.findUnique({
    where: { id: documentId },
    include: { lead: { include: { operator: { select: { claimedById: true } } } } },
  });
  if (!doc) throw new LeadError("No such document");
  if (doc.lead.operator.claimedById !== actorId) {
    throw new LeadError("This lead belongs to somebody else");
  }
  await prisma.leadDocument.delete({ where: { id: documentId } });
  const { deleteLeadDoc } = await import("./lead-docs");
  await deleteLeadDoc(doc.storageKey);
}

/** One lead with everything written on it — the card opened up. */
export async function readLead(leadId: string, userId: string) {
  const lead = await requireOwnedLead(leadId, userId);
  return prisma.siteLead.findUnique({
    where: { id: lead.id },
    include: {
      ownerEmployee: { include: { user: { select: { username: true, name: true } } } },
      notes: { orderBy: { createdAt: "asc" } },
      documents: { orderBy: { uploadedAt: "asc" } },
    },
  });
}
