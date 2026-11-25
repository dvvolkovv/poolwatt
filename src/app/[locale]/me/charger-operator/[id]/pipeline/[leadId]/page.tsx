// §48 — one lead opened up: its documents and the comments on it.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readLead } from "@/lib/crm/lead-service";
import { LeadDocuments } from "@/components/crm/lead-documents";

export const dynamic = "force-dynamic";

export default async function LeadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; leadId: string }>;
}) {
  const { locale, id, leadId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(
      `/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/pipeline/${leadId}`,
    );
  }

  // A lease belongs to the network negotiating it: anybody else gets a 404.
  const lead = await readLead(leadId, session.user.id).catch(() => null);
  if (!lead) notFound();

  const t = await getTranslations("pipeline");

  return (
    <div className="max-w-2xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}/pipeline`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("title")}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">
        {t(`stage.${lead.stage}`)}
      </div>
      <h1 className="mb-2 text-[28px] font-bold">{lead.title}</h1>
      <p className="mb-8 text-sm text-muted">
        {[lead.addressLine, lead.city, lead.country].filter(Boolean).join(", ") || "—"}
        {" · "}
        {lead.ownerEmployee
          ? (lead.ownerEmployee.user.name ?? lead.ownerEmployee.user.username)
          : t("nobody")}
        {lead.dueAt && (
          <>
            {" · "}
            {t("field.due")} <span className="num">{lead.dueAt.toISOString().slice(0, 10)}</span>
          </>
        )}
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("docsTitle")}
        </h2>
        <LeadDocuments
          leadId={lead.id}
          documents={lead.documents.map((d) => ({
            id: d.id,
            name: d.name,
            sizeBytes: d.sizeBytes,
            uploadedAt: d.uploadedAt.toISOString(),
          }))}
          labels={{
            upload: t("upload"),
            hint: t("uploadHint"),
            empty: t("noDocuments"),
            remove: t("dropDocument"),
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("comment")}</h2>
        {lead.notes.length === 0 ? (
          <p className="text-sm text-muted">{t("noNotes")}</p>
        ) : (
          <ul className="space-y-2 text-sm" data-testid="lead-notes">
            {lead.notes.map((n) => (
              <li key={n.id} className="border-l-2 border-hairline pl-3">
                <p className="whitespace-pre-line">{n.text}</p>
                <p className="num text-[11px] text-muted">
                  {n.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
