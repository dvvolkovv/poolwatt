// §29.6 / US-25 — "владелец сети пунктов создаёт шаблон и применяет его ко
// всем своим пунктам массово".
//
// §29.5 is what makes a bulk apply safe: an owner changes tariffs and hours
// without going back through moderation. So a template carries exactly those,
// and applying one never moves a point's status — fifty points quietly
// un-published would be the worst possible outcome of pressing one button.
//
// Every point touched gets its own §54 version, so a month priced under the
// old tariff still reads under the old tariff afterwards.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { recordPricingChange } from "@/lib/pricing/pricing-service";

export class TemplateError extends Error {}

/** §28 — one tariff window, as a template stores it. */
export interface TemplateTariff {
  label?: string | null;
  fromMinute: number;
  toMinute: number;
  priceFiat?: number | null;
  currency?: string;
  priceTokens?: number | null;
  idleFeePerMin?: number | null;
  coopDiscount?: number | null;
}

export interface TemplateInput {
  operatorId: string;
  actorId: string;
  name: string;
  tariffs: TemplateTariff[];
  open24?: boolean;
  openHours?: Prisma.InputJsonValue | null;
  holidayNote?: string | null;
  paymentMethods?: string[];
  amenities?: string[];
}

async function requireNetwork(operatorId: string, userId: string) {
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true },
  });
  if (!op) throw new TemplateError("No such network");
  if (!op.claimedById || op.claimedById !== userId) {
    throw new TemplateError("This network belongs to somebody else");
  }
  return op;
}

function validateTariffs(tariffs: TemplateTariff[]): void {
  for (const t of tariffs) {
    for (const [field, value] of [
      ["fromMinute", t.fromMinute],
      ["toMinute", t.toMinute],
    ] as const) {
      if (!Number.isInteger(value) || value < 0 || value > 1440) {
        throw new TemplateError(`${field} is a minute of the day, from 0 to 1440`);
      }
    }
    if (t.toMinute <= t.fromMinute) {
      throw new TemplateError("A tariff window has to end after it starts");
    }
    for (const [field, value] of [
      ["priceFiat", t.priceFiat],
      ["priceTokens", t.priceTokens],
      ["idleFeePerMin", t.idleFeePerMin],
    ] as const) {
      if (value != null && !(value >= 0)) {
        throw new TemplateError(`${field} cannot be a negative price`);
      }
    }
    if (t.coopDiscount != null && (t.coopDiscount < 0 || t.coopDiscount > 100)) {
      throw new TemplateError("A cooperative discount is a percentage from 0 to 100");
    }
  }
}

export async function saveTemplate(input: TemplateInput) {
  await requireNetwork(input.operatorId, input.actorId);
  if (!input.name?.trim()) throw new TemplateError("A template needs a name");
  validateTariffs(input.tariffs);

  const setsHours =
    input.open24 === true || input.openHours != null || Boolean(input.holidayNote);
  if (input.tariffs.length === 0 && !setsHours) {
    throw new TemplateError("A template with no tariff and no hours would do nothing");
  }

  const data = {
    tariffs: input.tariffs as unknown as Prisma.InputJsonValue,
    open24: input.open24 ?? false,
    openHours: input.openHours ?? Prisma.DbNull,
    holidayNote: input.holidayNote?.trim() || null,
    paymentMethods: input.paymentMethods ?? [],
    amenities: input.amenities ?? [],
    createdById: input.actorId,
  };

  return prisma.pointTemplate.upsert({
    where: { operatorId_name: { operatorId: input.operatorId, name: input.name.trim() } },
    update: data,
    create: { operatorId: input.operatorId, name: input.name.trim(), ...data },
  });
}

export async function readTemplates(operatorId: string, userId: string) {
  await requireNetwork(operatorId, userId);
  return prisma.pointTemplate.findMany({
    where: { operatorId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function deleteTemplate(templateId: string, userId: string): Promise<void> {
  const template = await prisma.pointTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new TemplateError("No such template");
  await requireNetwork(template.operatorId, userId);
  // The points keep what the template gave them: a template is a shortcut for
  // typing, not the authority the tariffs live under.
  await prisma.pointTemplate.delete({ where: { id: templateId } });
}

/**
 * Apply a template. `pointIds` null means the whole network — the normal case
 * for the story, which is about rolling one offer out across fifty stations.
 */
export async function applyTemplate(args: {
  templateId: string;
  pointIds: string[] | null;
  actorId: string;
}): Promise<{ applied: number; pointIds: string[] }> {
  const template = await prisma.pointTemplate.findUnique({ where: { id: args.templateId } });
  if (!template) throw new TemplateError("No such template");
  await requireNetwork(template.operatorId, args.actorId);

  const targets = await prisma.acceptancePoint.findMany({
    where: {
      operatorId: template.operatorId,
      ...(args.pointIds ? { id: { in: args.pointIds } } : {}),
    },
    select: { id: true },
  });

  // A list naming a point of somebody else's is refused rather than silently
  // narrowed: an owner who mistyped an id should hear about it.
  if (args.pointIds && targets.length !== new Set(args.pointIds).size) {
    throw new TemplateError("One of those points is not in this network");
  }
  if (targets.length === 0) return { applied: 0, pointIds: [] };

  const tariffs = (template.tariffs ?? []) as unknown as TemplateTariff[];
  const ids = targets.map((p) => p.id);

  await prisma.$transaction(
    async (tx) => {
      for (const pointId of ids) {
        await tx.acceptancePoint.update({
          where: { id: pointId },
          data: {
            open24: template.open24,
            openHours: template.openHours ?? Prisma.DbNull,
            holidayNote: template.holidayNote,
            ...(template.paymentMethods.length > 0
              ? { paymentMethods: template.paymentMethods }
              : {}),
            ...(template.amenities.length > 0 ? { amenities: template.amenities } : {}),
          },
        });

        if (tariffs.length > 0) {
          await tx.pointTariff.deleteMany({ where: { pointId } });
          for (const t of tariffs) {
            await tx.pointTariff.create({
              data: {
                pointId,
                label: t.label ?? null,
                fromMinute: t.fromMinute,
                toMinute: t.toMinute,
                priceFiat: t.priceFiat == null ? null : new Prisma.Decimal(t.priceFiat),
                currency: t.currency ?? "EUR",
                priceTokens: t.priceTokens == null ? null : new Prisma.Decimal(t.priceTokens),
                idleFeePerMin:
                  t.idleFeePerMin == null ? null : new Prisma.Decimal(t.idleFeePerMin),
                coopDiscount: t.coopDiscount ?? 0,
              },
            });
          }

          // §54 — each point's own version, with the template named, so the
          // history explains where the number came from.
          await recordPricingChange(tx, {
            scope: "POINT_TARIFF",
            scopeId: pointId,
            operatorId: template.operatorId,
            params: { tariffs } as unknown as Prisma.InputJsonValue,
            actorId: args.actorId,
            note: `Template: ${template.name}`,
          });
        }
      }

      await tx.pointTemplate.update({
        where: { id: template.id },
        data: { lastAppliedAt: new Date(), lastAppliedCount: ids.length },
      });

      // One entry for the whole run: fifty near-identical lines would bury the
      // one fact that matters, which is that somebody pressed the button.
      await writeAudit(tx, {
        actor: args.actorId,
        entity: "PointTemplate",
        entityId: template.id,
        action: "point.template.applied",
        after: { name: template.name, applied: ids.length, pointIds: ids },
      });
    },
    // Fifty points, two tariff rows and a version each: well inside a
    // transaction, but not inside the default five seconds.
    { timeout: 60_000 },
  );

  return { applied: ids.length, pointIds: ids };
}
