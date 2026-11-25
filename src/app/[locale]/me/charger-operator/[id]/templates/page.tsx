// US-25 / §29.6 — one offer across a whole network of points.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readTemplates, type TemplateTariff } from "@/lib/points/point-template";
import { TemplateForm } from "@/components/points/template-form";
import { ApplyTemplate } from "@/components/points/apply-template";

export const dynamic = "force-dynamic";

function window(fromMinute: number, toMinute: number): string {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (fromMinute === 0 && toMinute >= 1440) return "24/7";
  return `${hhmm(fromMinute)}–${hhmm(toMinute)}`;
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/templates`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  // A template rewrites the price at every point: the owner's decision only.
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("templates");

  const [templates, points] = await Promise.all([
    readTemplates(id, session.user.id),
    prisma.acceptancePoint.findMany({
      where: { operatorId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-8 text-sm text-muted">{t("intro")}</p>

      <section className="mb-12">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("new")}</h2>
        <TemplateForm
          operatorId={id}
          labels={{
            name: t("field.name"),
            windows: t("field.windows"),
            windowLabel: t("field.windowLabel"),
            fromHour: t("field.fromHour"),
            toHour: t("field.toHour"),
            priceFiat: t("field.priceFiat"),
            priceTokens: t("field.priceTokens"),
            idleFee: t("field.idleFee"),
            coopDiscount: t("field.coopDiscount"),
            addWindow: t("addWindow"),
            dropWindow: t("dropWindow"),
            open24: t("field.open24"),
            holidayNote: t("field.holidayNote"),
            paymentMethods: t("field.paymentMethods"),
            currency: t("field.currency"),
            save: t("save"),
            help: t("formHelp"),
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("list")}</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="template-list">
            {templates.map((tpl) => {
              const tariffs = (tpl.tariffs ?? []) as unknown as TemplateTariff[];
              return (
                <li key={tpl.id} className="space-y-3 py-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium">{tpl.name}</span>
                    <span className="text-[12px] text-muted">
                      {tpl.lastAppliedAt
                        ? `${t("lastApplied")} ${tpl.lastAppliedAt
                            .toISOString()
                            .slice(0, 10)} · ${tpl.lastAppliedCount} ${t("points")}`
                        : t("neverApplied")}
                    </span>
                  </div>

                  <ul className="text-[13px] text-muted">
                    {tariffs.map((tr, i) => (
                      <li key={i}>
                        <span className="num">{window(tr.fromMinute, tr.toMinute)}</span>
                        {tr.label ? ` · ${tr.label}` : ""}
                        {tr.priceFiat != null && (
                          <>
                            {" · "}
                            <span className="num">{tr.priceFiat}</span> {tr.currency ?? "EUR"}
                          </>
                        )}
                        {tr.priceTokens != null && (
                          <>
                            {" · "}
                            <span className="num">{tr.priceTokens}</span> {t("tokens")}
                          </>
                        )}
                        {tr.coopDiscount ? (
                          <>
                            {" · "}
                            {t("field.coopDiscount")} <span className="num">{tr.coopDiscount}</span>%
                          </>
                        ) : null}
                      </li>
                    ))}
                    <li>
                      {tpl.open24 ? "24/7" : t("ownHours")}
                      {tpl.paymentMethods.length > 0 && ` · ${tpl.paymentMethods.join(", ")}`}
                    </li>
                  </ul>

                  <ApplyTemplate
                    templateId={tpl.id}
                    points={points}
                    labels={{
                      applyAll: t("applyAll"),
                      applySelected: t("applySelected"),
                      pick: t("pick"),
                      remove: t("remove"),
                      applied: t("applied"),
                      allHint: t("allHint"),
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
