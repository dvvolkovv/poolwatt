import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus } from "@prisma/client";
import { ContractorStatusForm } from "@/components/admin/contractor-status-form";

const NEXT: Record<ContractorStatus, ContractorStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  SUSPENDED: [],
};

export default async function AdminContractorDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const c = await prisma.contractor.findUnique({
    where: { id },
    include: {
      members: {
        where: { role: "OWNER" },
        take: 1,
        include: { user: { select: { username: true, name: true, email: true, phone: true } } },
      },
    },
  });
  if (!c) notFound();

  const owner = c.members[0]?.user;
  const t = await getTranslations("admin.contractor");

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/${locale}/admin/contractors`} className="text-sm text-muted">← Back</Link>
      <h1 className="text-[28px] font-bold">{c.displayName} <span className="text-sm text-muted">#{c.id.slice(0, 8)}</span></h1>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Owner</h2>
        {owner ? (
          <>
            <p><b>@{owner.username}</b> ({owner.name ?? "—"})</p>
            <p>Email: {owner.email ?? "—"}</p>
            <p>Phone: {owner.phone ?? "—"}</p>
          </>
        ) : (
          <p className="text-muted">No OWNER member</p>
        )}
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Identity</h2>
        <p>Type: {c.entityType}</p>
        {c.legalName && <p>Legal: {c.legalName}</p>}
        {c.registrationNumber && <p>Reg #: {c.registrationNumber}</p>}
        <p>HQ: {c.country}, {c.city}</p>
        {c.foundedYear != null && <p>Founded: {c.foundedYear}</p>}
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">What they do</h2>
        <p>Work: {c.workCategories.join(", ")}</p>
        <p>Renewables: {c.renewableTypes.join(", ")}</p>
        <p>Countries served: {c.countriesServed.join(", ")}</p>
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Contact & profile</h2>
        <p>Email: {c.contactEmail}</p>
        <p>Phone: {c.contactPhone}</p>
        {c.websiteUrl && <p>Website: <a href={c.websiteUrl} className="underline" target="_blank" rel="noreferrer">{c.websiteUrl}</a></p>}
        {c.logoUrl && <p>Logo: <a href={c.logoUrl} className="underline" target="_blank" rel="noreferrer">{c.logoUrl}</a></p>}
        <p className="mt-2 whitespace-pre-wrap text-sm">{c.bio}</p>
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Status</h2>
        <p>Current: <b>{c.status}</b></p>
        {c.adminNote && <p className="text-sm text-muted mt-2">Note: {c.adminNote}</p>}
      </section>

      <ContractorStatusForm
        id={c.id}
        currentStatus={c.status}
        allowedNext={NEXT[c.status]}
        labels={{
          setStatus: t("action.setStatus"),
          adminNote: t("action.adminNote"),
          submit: t("action.submit"),
        }}
      />
    </div>
  );
}
