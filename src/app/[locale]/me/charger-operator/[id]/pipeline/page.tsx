// §48 "Воронка развития сети" / US-51 — the kanban board, by §48's seven
// stages, with the person answerable and the date on every card.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEAD_STAGES, readBoard } from "@/lib/crm/lead-service";
import { LeadCard } from "@/components/crm/lead-card";
import { NewLeadForm } from "@/components/crm/new-lead-form";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/pipeline`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("pipeline");

  const [board, staff] = await Promise.all([
    readBoard(id, session.user.id),
    prisma.employee.findMany({
      where: { operatorId: id },
      include: { user: { select: { username: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const employees = staff.map((e) => ({
    id: e.id,
    name: e.user.name ?? e.user.username,
  }));
  const stageNames = Object.fromEntries(LEAD_STAGES.map((s) => [s, t(`stage.${s}`)]));

  const cardLabels = {
    owner: t("field.owner"),
    nobody: t("nobody"),
    due: t("field.due"),
    overdue: t("overdue"),
    moveTo: t("moveTo"),
    comment: t("comment"),
    send: t("send"),
    lost: t("lost"),
    lostWhy: t("lostWhy"),
    reopen: t("reopen"),
    remove: t("remove"),
    notes: t("notes"),
    documents: t("documents"),
    save: t("save"),
    stageNames,
  };

  const toCard = (l: (typeof board.columns)[number]["leads"][number]) => ({
    id: l.id,
    title: l.title,
    city: l.city,
    stage: l.stage,
    ownerEmployeeId: l.ownerEmployeeId,
    ownerName: l.ownerName,
    dueAt: l.dueAt?.toISOString() ?? null,
    overdue: l.overdue,
    noteCount: l.noteCount,
    documentCount: l.documentCount,
    lostReason: l.lostReason,
  });

  return (
    <div>
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-6 text-sm text-muted">{t("intro")}</p>

      <section className="mb-8 flex flex-wrap gap-6 text-sm" data-testid="pipeline-totals">
        {[
          [t("totalOpen"), board.totals.open],
          [t("totalOverdue"), board.totals.overdue],
          [t("totalPublished"), board.totals.published],
          [t("totalLost"), board.totals.lost],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
            <div className="num text-[20px] font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("new")}</h2>
        <NewLeadForm
          operatorId={id}
          employees={employees}
          labels={{
            title: t("field.title"),
            city: t("field.city"),
            country: t("field.country"),
            address: t("field.address"),
            owner: t("field.owner"),
            nobody: t("nobody"),
            due: t("field.due"),
            create: t("create"),
          }}
        />
      </section>

      <section className="mb-10 overflow-x-auto">
        <div className="flex min-w-max gap-4" data-testid="pipeline-board">
          {board.columns.map((column) => (
            <div key={column.stage} className="w-[260px] shrink-0">
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
                {stageNames[column.stage]}
                {" · "}
                <span className="num">{column.leads.length}</span>
              </h3>
              <div className="space-y-2" data-testid={`column-${column.stage}`}>
                {column.leads.length === 0 ? (
                  <p className="text-[12px] text-muted">{t("emptyColumn")}</p>
                ) : (
                  column.leads.map((l) => (
                    <LeadCard
                      key={l.id}
                      lead={toCard(l)}
                      stages={[...LEAD_STAGES]}
                      employees={employees}
                      locale={locale}
                      operatorId={id}
                      labels={cardLabels}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {board.lost.length > 0 && (
        <section>
          <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
            {t("lostTitle")}
          </h2>
          <p className="mb-3 text-[12px] text-muted">{t("lostHelp")}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3" data-testid="pipeline-lost">
            {board.lost.map((l) => (
              <LeadCard
                key={l.id}
                lead={toCard(l)}
                stages={[...LEAD_STAGES]}
                employees={employees}
                locale={locale}
                operatorId={id}
                labels={cardLabels}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
