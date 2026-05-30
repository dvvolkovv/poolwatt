import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";

const VALID_STATUSES: BuildRequestStatus[] = ["OPEN", "MATCHED", "FULFILLED", "CANCELLED"];

export default async function AdminBuildRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; country?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { status: rawStatus, country: rawCountry, page: rawPage } = await searchParams;
  setRequestLocale(locale);

  const status = VALID_STATUSES.includes(rawStatus as BuildRequestStatus)
    ? (rawStatus as BuildRequestStatus)
    : undefined;
  const country = rawCountry?.match(/^[A-Z]{2}$/) ? rawCountry : undefined;
  const page = Math.max(1, Number(rawPage) || 1);
  const pageSize = 50;

  const where = {
    ...(status ? { status } : {}),
    ...(country ? { country } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.buildRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, createdAt: true, source: true, peakKw: true,
        country: true, city: true, status: true,
        user: { select: { username: true } },
      },
    }),
    prisma.buildRequest.count({ where }),
  ]);

  const t = await getTranslations("admin.buildRequest");

  return (
    <div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      <form className="flex gap-2 mb-6 text-sm">
        <select name="status" defaultValue={status ?? ""} className="border border-hairline rounded px-2 py-1">
          <option value="">{t("filter.all")}</option>
          {VALID_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <input name="country" defaultValue={country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-2 py-1 w-20 uppercase" />
        <button type="submit" className="px-3 py-1 border border-hairline rounded">Apply</button>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th className="py-2">{t("table.createdAt")}</th>
            <th>{t("table.owner")}</th>
            <th>{t("table.source")}</th>
            <th className="text-right">kW</th>
            <th>{t("table.country")}</th>
            <th>{t("table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-hairline">
              <td className="py-2">
                <Link href={`/${locale}/admin/build-requests/${r.id}`} className="underline">
                  {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </Link>
              </td>
              <td>@{r.user.username}</td>
              <td>{r.source}</td>
              <td className="text-right num">{r.peakKw.toString()}</td>
              <td>{r.country} {r.city}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-muted mt-4">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}, {total} total.</p>
    </div>
  );
}
