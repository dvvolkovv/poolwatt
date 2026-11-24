// ТЗ §16.11: "Каждое изменение баланса и статуса пишется в AuditLog".
//
// Deliberately fire-and-forget-free: the write takes the same transaction
// client as the change it records, so a rolled-back trade leaves no audit
// entry claiming it happened.

import type { Prisma, PrismaClient } from "@prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actor: string;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actor: entry.actor,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: (entry.before ?? null) as Prisma.InputJsonValue,
      after: (entry.after ?? null) as Prisma.InputJsonValue,
    },
  });
}

export async function writeAuditMany(db: Db, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.auditLog.createMany({
    data: entries.map((e) => ({
      actor: e.actor,
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      before: (e.before ?? null) as Prisma.InputJsonValue,
      after: (e.after ?? null) as Prisma.InputJsonValue,
    })),
  });
}
