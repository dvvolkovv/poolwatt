// One listing application: documents, screening and the decision form (US-02).

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publishableIban } from "@/lib/exchange/gates";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { DecisionForm } from "@/components/exchange/decision-form";

type Doc = { name?: string; url?: string; bytes?: number; mime?: string };

export default async function AdminListingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("admin.listings");

  const application = await prisma.listingApplication.findUnique({
    where: { id },
    include: {
      company: {
        include: {
          assets: {
            select: { id: true, name: true, kind: true, capacityKw: true, status: true },
          },
          settlementAccount: { select: { iban: true, currency: true } },
        },
      },
      reviewer: { select: { username: true } },
    },
  });
  if (!application) notFound();

  const documents: Doc[] = Array.isArray(application.documents)
    ? (application.documents as Doc[])
    : [];

  return (
    <div>
      <Link
        href={`/${locale}/admin/listings`}
        prefetch={false}
        className="text-[13px] text-muted hover:text-foreground underline"
      >
        ← {t("back")}
      </Link>

      <h1 className="text-[28px] font-bold mt-3 mb-1">{application.company.legalName}</h1>
      <p className="text-sm text-muted mb-6 num">
        {application.company.country} · {application.company.type} · {application.company.regNumber}
      </p>

      <dl className="text-sm grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Field label={t("status")} value={application.status} />
        <Field label={t("kyb")} value={application.company.kybStatus} />
        <Field
          label={t("submitted")}
          value={application.submittedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
        />
        <Field
          label={t("decided")}
          value={application.decidedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
        />
        <Field label={t("reviewer")} value={application.reviewer?.username ?? "—"} />
        <Field
          label={t("account")}
          value={publishableIban(application.company.settlementAccount?.iban) ?? "—"}
        />
      </dl>

      <section className="mb-8">
        <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
          {t("documents")}
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-muted">{t("noDocuments")}</p>
        ) : (
          <ul className="text-sm space-y-1">
            {documents.map((d, i) => (
              <li key={`${d.url ?? i}`} className="flex items-center gap-3">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {d.name ?? d.url}
                </a>
                <span className="text-[12px] text-muted num">
                  {d.mime} · {d.bytes ? `${Math.round(d.bytes / 1024)} KB` : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">{t("assets")}</h2>
        {application.company.assets.length === 0 ? (
          <p className="text-sm text-muted">—</p>
        ) : (
          <ul className="text-sm space-y-1">
            {application.company.assets.map((a) => (
              <li key={a.id} className="flex justify-between border-b border-hairline py-1.5">
                <span>
                  {a.name} <span className="text-muted">· {a.kind}</span>
                </span>
                <span className="num text-muted">
                  {num(a.capacityKw).toFixed(3)} kW · {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {application.status === "SUBMITTED" ? (
        <DecisionForm
          applicationId={application.id}
          labels={{
            title: t("review"),
            approve: t("approve"),
            reject: t("reject"),
            comment: t("comment"),
            screening: t("screening"),
          }}
        />
      ) : (
        application.decisionComment && (
          <p className="text-sm border border-hairline rounded p-3">
            {application.decisionComment}
          </p>
        )
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="num mt-0.5">{value}</dd>
    </div>
  );
}
