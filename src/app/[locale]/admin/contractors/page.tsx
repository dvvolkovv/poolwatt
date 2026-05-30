import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus, ContractorEntityType } from "@prisma/client";

const VALID_STATUSES: ContractorStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];
const VALID_ENTITY: ContractorEntityType[] = ["LEGAL_ENTITY", "SOLE_TRADER", "INDIVIDUAL"];

export default async function AdminContractorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; country?: string; entityType?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { status: rs, country: rc, entityType: re, page: rp } = await searchParams;
  setRequestLocale(locale);

  const status = VALID_STATUSES.includes(rs as ContractorStatus) ? (rs as ContractorStatus) : undefined;
  const country = rc?.match(/^[A-Z]{2}$/) ? rc : undefined;
  const entityType = VALID_ENTITY.includes(re as ContractorEntityType) ? (re as ContractorEntityType) : undefined;
  const page = Math.max(1, Number(rp) || 1);
  const pageSize = 50;

  const where = {
    ...(status ? { status } : {}),
    ...(country ? { country } : {}),
    ...(entityType ? { entityType } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.contractor.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        members: { where: { role: "OWNER" }, take: 1, include: { user: { select: { username: true } } } },
      },
    }),
    prisma.contractor.count({ where }),
  ]);

  const t = await getTranslations("admin.contractor");

  return (
    <div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      <form className="flex gap-2 mb-6 text-sm">
        <select name="status" defaultValue={status ?? ""} className="border border-hairline rounded px-2 py-1">
          <option value="">{t("filter.all")}</option>
          {VALID_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <input name="country" defaultValue={country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-2 py-1 w-20 uppercase" />
        <select name="entityType" defaultValue={entityType ?? ""} className="border border-hairline rounded px-2 py-1">
          <option value="">{t("filter.all")}</option>
          {VALID_ENTITY.map((e) => (<option key={e} value={e}>{e}</option>))}
        </select>
        <button type="submit" className="px-3 py-1 border border-hairline rounded">Apply</button>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th className="py-2">{t("table.createdAt")}</th>
            <th>{t("table.owner")}</th>
            <th>{t("table.displayName")}</th>
            <th>{t("table.entityType")}</th>
            <th>{t("table.country")}</th>
            <th>{t("table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-hairline">
              <td className="py-2">
                <Link href={`/${locale}/admin/contractors/${c.id}`} className="underline">
                  {c.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </Link>
              </td>
              <td>@{c.members[0]?.user.username ?? "—"}</td>
              <td>{c.displayName}</td>
              <td>{c.entityType}</td>
              <td>{c.country} {c.city}</td>
              <td>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-muted mt-4">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}, {total} total.</p>
    </div>
  );
}
