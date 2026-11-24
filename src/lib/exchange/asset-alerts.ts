// Asset alarms — ТЗ §30 "Уведомления", US-29 ("получать уведомление об
// аварии"), criterion "push и email в течение минуты после события".
//
// An alarm is a condition, not an event stream: while a fault is open there is
// exactly one row for it, so equipment that flaps does not mail the engineer
// every minute. The row owes a notification until it has been sent; the worker
// comes back for it each minute, which is also what makes a failed send
// recoverable.
//
// Push is not sent: it needs APNs and FCM keys that only the owner can get
// (gates.pushOpen). Until then the alarm reaches people by mail and on the
// station console.

import { AssetAlertKind, AssetStatus, type AssetAlert } from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { pushOpen } from "./gates";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

/** §30 — equipment is "lost" after three settlement intervals of silence. */
const SILENT_INTERVALS = 3;

export interface RaiseAlertArgs {
  assetId: string;
  kind: AssetAlertKind;
  note: string;
  occurredAt?: Date;
}

/**
 * Open an alarm, or return null if the same fault is already open.
 *
 * Returning null rather than throwing is deliberate: callers raise alarms from
 * inside telemetry ingestion, and a repeat is the normal case, not an error.
 */
export async function raiseAlert(
  db: Db,
  args: RaiseAlertArgs,
): Promise<AssetAlert | null> {
  const open = await db.assetAlert.findFirst({
    where: { assetId: args.assetId, kind: args.kind, resolvedAt: null },
    select: { id: true },
  });
  if (open) return null;

  const alert = await db.assetAlert.create({
    data: {
      assetId: args.assetId,
      kind: args.kind,
      note: args.note.slice(0, 500),
      occurredAt: args.occurredAt ?? new Date(),
    },
  });
  await writeAudit(db, {
    actor: "system",
    entity: "Asset",
    entityId: args.assetId,
    action: "asset.alert.raised",
    after: { alertId: alert.id, kind: args.kind, note: alert.note },
  });
  return alert;
}

export async function resolveAlert(
  alertId: string,
  actorUserId: string,
  note: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const alert = await tx.assetAlert.findUniqueOrThrow({ where: { id: alertId } });
    if (alert.resolvedAt) throw new Error("Alert is already resolved");

    await tx.assetAlert.update({
      where: { id: alertId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: actorUserId,
        resolutionNote: note.slice(0, 500),
      },
    });
    await writeAudit(tx, {
      actor: actorUserId,
      entity: "Asset",
      entityId: alert.assetId,
      action: "asset.alert.resolved",
      before: { alertId, kind: alert.kind },
      after: { note: note.slice(0, 500) },
    });
  });
}

/**
 * Open a LINK_LOST alarm for every active asset that has gone quiet.
 *
 * An asset that has never reported is left alone: it has not been connected
 * yet, which is the installer's business and not an alarm.
 */
export async function detectLinkLoss(now = new Date()): Promise<number> {
  const assets = await prisma.asset.findMany({
    where: { status: AssetStatus.ACTIVE },
    select: {
      id: true,
      name: true,
      gridZone: { select: { intervalMinutes: true } },
      readings: {
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: { receivedAt: true },
      },
    },
  });

  let raised = 0;
  for (const asset of assets) {
    const last = asset.readings[0]?.receivedAt;
    if (!last) continue;
    const silentMs = now.getTime() - last.getTime();
    const limitMs = SILENT_INTERVALS * asset.gridZone.intervalMinutes * 60 * 1000;
    if (silentMs <= limitMs) continue;

    const alert = await raiseAlert(prisma, {
      assetId: asset.id,
      kind: AssetAlertKind.LINK_LOST,
      note: `No reading since ${last.toISOString()}`,
      occurredAt: now,
    });
    if (alert) raised += 1;
  }
  return raised;
}

export interface NotifyOptions {
  /** Injected so tests never send mail, and so push can slot in later. */
  sendTo?: (to: string, subject: string, html: string) => Promise<void>;
}

const defaultSend = (to: string, subject: string, html: string) =>
  sendEmail({ to, subject, html });

/**
 * Tell people about every alarm that still owes a notification.
 *
 * Runs every minute from the worker, which is how the "в течение минуты"
 * criterion is met. An alarm is marked as told only after the mail went out,
 * so a provider outage is retried rather than swallowed.
 */
export async function notifyPendingAlerts(options: NotifyOptions = {}): Promise<number> {
  const send = options.sendTo ?? defaultSend;

  const pending = await prisma.assetAlert.findMany({
    where: { notifiedAt: null, resolvedAt: null },
    orderBy: { occurredAt: "asc" },
    include: {
      asset: {
        select: {
          id: true,
          name: true,
          companyId: true,
          company: {
            select: {
              legalName: true,
              contactEmail: true,
              owner: { select: { email: true, emailVerified: true } },
            },
          },
        },
      },
    },
  });

  let notified = 0;
  for (const alert of pending) {
    const company = alert.asset.company;
    const owner = company.owner;
    const recipients = new Set<string>();
    // Only addresses somebody has proved they own, or the contact the
    // operator approved with the listing.
    if (owner?.email && owner.emailVerified) recipients.add(owner.email);
    if (company.contactEmail) recipients.add(company.contactEmail);
    if (recipients.size === 0) continue;

    const url = `${BASE}/en/me/listing/${alert.asset.companyId}/assets/${alert.asset.id}`;
    const subject = `[Poolwatt] ${alertTitle(alert.kind)} — ${alert.asset.name}`;
    const html = `
      <p><b>${alertTitle(alert.kind)}</b> on <b>${alert.asset.name}</b>
         (${company.legalName}).</p>
      <p>${alert.note}</p>
      <p>Detected at ${alert.occurredAt.toISOString()}.</p>
      <p><a href="${url}">Open the station console</a></p>
    `;

    try {
      for (const to of recipients) await send(to, subject, html);
      if (pushOpen()) await sendPush(alert.asset.id, subject);
      await prisma.assetAlert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
      notified += 1;
    } catch (err) {
      // Left owing on purpose: the next minute tries again.
      console.error(`[alerts] notification failed for ${alert.id}`, err);
    }
  }
  return notified;
}

function alertTitle(kind: AssetAlertKind): string {
  switch (kind) {
    case AssetAlertKind.TELEMETRY_ANOMALY:
      return "Telemetry anomaly";
    case AssetAlertKind.LINK_LOST:
      return "Equipment offline";
    case AssetAlertKind.SUSPENDED:
      return "Asset suspended";
  }
}

/** Reached only once the owner supplies APNs and FCM keys (gates.pushOpen). */
async function sendPush(assetId: string, subject: string): Promise<void> {
  console.warn(`[alerts] push is open but no provider is wired yet: ${assetId} ${subject}`);
}
