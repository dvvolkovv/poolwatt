// One company's listing application — ТЗ §4, §14, US-01.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DocumentsPanel } from "@/components/listing/documents-panel";
import { num } from "@/lib/exchange/decimal";
import { type ListingDocument, documentsOf } from "@/lib/exchange/listing-service";
import { prisma } from "@/lib/prisma";

export default async function ListingCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; companyId: string }>;
}) {
  const { locale, companyId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/listing/${companyId}`);
  }

  const t = await getTranslations("cabinet.listing");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      legalName: true,
      country: true,
      regNumber: true,
      vatNumber: true,
      type: true,
      kybStatus: true,
      ownerUserId: true,
      assets: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, kind: true, capacityKw: true, status: true },
      },
      applications: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          documents: true,
          submittedAt: true,
          decidedAt: true,
          decisionComment: true,
        },
      },
    },
  });
  if (!company) notFound();
  if (company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") notFound();

  const application = company.applications[0] ?? null;
  const documents: ListingDocument[] = application ? documentsOf(application) : [];
  // §14 — papers are only editable while the application is a draft.
  const editable = !application || application.status === "DRAFT";

  const notice =
    application?.status === "SUBMITTED"
      ? t("detail.submittedNotice")
      : application?.status === "APPROVED"
        ? t("detail.approvedNotice")
        : application?.status === "REJECTED"
          ? t("detail.rejectedNotice")
          : null;

  return (
    <div>
      <Link
        href={`/${locale}/me/listing`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("detail.back")}
      </Link>

      <h1 className="mb-1 mt-3 text-[28px] font-bold">{company.legalName}</h1>
      <p className="num mb-6 text-sm text-muted">
        {company.country} · {t(`type.${company.type}`)} · {company.regNumber}
        {company.vatNumber ? ` · ${company.vatNumber}` : ""}
      </p>

      <dl className="mb-8 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Field
          label={t("applicationStatus")}
          value={application ? t(`status.${application.status}`) : t("noApplication")}
        />
        <Field label="KYB" value={t(`kyb.${company.kybStatus}`)} />
        <Field
          label={t("detail.decidedAt")}
          value={application?.decidedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
        />
        <Field label={t("assetsCount")} value={String(company.assets.length)} />
      </dl>

      {notice && (
        <p className="mb-6 rounded border border-accent/40 bg-card px-4 py-3 text-sm">{notice}</p>
      )}

      {application?.decisionComment && (
        <div className="mb-8 rounded border border-hairline p-4">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("detail.operatorComment")}
          </div>
          <p className="text-sm">{application.decisionComment}</p>
        </div>
      )}

      <div className="mb-10">
        <DocumentsPanel
          companyId={company.id}
          initial={documents}
          editable={editable}
          labels={{
            documents: t("detail.documents"),
            documentsHelp: t("detail.documentsHelp"),
            noDocuments: t("detail.noDocuments"),
            upload: t("detail.upload"),
            uploading: t("detail.uploading"),
            remove: t("detail.remove"),
            submit: t("detail.submit"),
            submitting: t("detail.submitting"),
            needDocuments: t("detail.needDocuments"),
          }}
        />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted">
            {t("detail.assets")}
          </h2>
          <span className="flex gap-4 text-[13px]">
            <Link
              href={`/${locale}/me/listing/${company.id}/assets`}
              prefetch={false}
              className="underline"
            >
              {t("detail.assetsLink")} →
            </Link>
            <Link
              href={`/${locale}/me/listing/${company.id}/tokens`}
              prefetch={false}
              className="underline"
            >
              {t("detail.tokensLink")} →
            </Link>
          </span>
        </div>
        {company.assets.length === 0 ? (
          <p className="text-sm text-muted">—</p>
        ) : (
          <ul className="text-sm">
            {company.assets.map((a) => (
              <li
                key={a.id}
                className="flex justify-between border-b border-hairline py-1.5"
              >
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
