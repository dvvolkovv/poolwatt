"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";

export type SaveResult = { ok?: boolean; formError?: string; fieldErrors?: Record<string, string> };

const schema = z.object({
  legalName: z.string().max(200).nullable(),
  regNumber: z.string().max(60).nullable(),
  vatNumber: z.string().max(60).nullable(),
  addressLine: z.string().max(200).nullable(),
  city: z.string().max(100).nullable(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "Two-letter country code")
    .nullable(),
  // §46 item 7 — the partner's own rate. We validate the range, never supply
  // a value: an invented VAT rate is a wrong tax document.
  vatRatePct: z.number().min(0).max(100).nullable(),
  taxNote: z.string().max(500).nullable(),
  datevConsultantNo: z.string().max(20).nullable(),
  datevClientNo: z.string().max(20).nullable(),
  revenueAccount: z.string().max(20).nullable(),
  counterAccount: z.string().max(20).nullable(),
  fiscalYearStart: z.number().int().min(1).max(12).nullable(),
  bmdClientNo: z.string().max(20).nullable(),
});

/** §46 "Бухгалтерия партнёра" — only the network's owner edits its requisites. */
export async function saveOperatorAccounting(
  input: { operatorId: string } & Record<string, unknown>,
): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const operator = await prisma.chargerOperator.findUnique({
    where: { id: input.operatorId },
    select: { id: true, claimedById: true },
  });
  if (!operator) return { formError: "Сеть не найдена" };
  if (operator.claimedById !== session.user.id && session.user.role !== "ADMIN") {
    return { formError: "Это не ваша сеть" };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_form")] = issue.message;
    }
    return { fieldErrors };
  }

  const data = {
    ...parsed.data,
    country: parsed.data.country?.toUpperCase() ?? null,
    fiscalYearStart: parsed.data.fiscalYearStart ?? 1,
  };

  await prisma.operatorAccounting.upsert({
    where: { operatorId: operator.id },
    create: { operatorId: operator.id, ...data },
    update: data,
  });

  // §47 — "все действия сотрудников пишутся в журнал аудита"; requisites that
  // end up on tax documents are exactly the kind of change to keep.
  await writeAudit(prisma, {
    actor: session.user.id,
    entity: "OperatorAccounting",
    entityId: operator.id,
    action: "accounting.requisites.saved",
    after: data,
  });

  revalidatePath(`/[locale]/me/charger-operator/[id]/accounting`, "page");
  return { ok: true };
}
