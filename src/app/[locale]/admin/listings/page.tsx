// Operator moderation queue — ТЗ §9 "Панель оператора", US-02.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ListingApplicationStatus } from "@prisma/client";

const VALID_STATUSES: ListingApplicationStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
];

export default async function AdminListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: rawStatus } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("admin.listings");

  // The queue defaults to what needs a decision.
  const status = VALID_STATUSES.includes(rawStatus as ListingApplicationStatus)
    ? (rawStatus as ListingApplicationStatus)
    : "SUBMITTED";

  const rows = await prisma.listingApplication.findMany({
    where: { status },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      company: {
        select: {
          legalName: true,
          country: true,
          type: true,
          kybStatus: true,
          _count: { select: { assets: true } },
        },
      },
    },
  });

  return (
    <div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      <nav className="flex gap-2 mb-6 text-sm">
        {VALID_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${locale}/admin/listings?status=${s}`}
            prefetch={false}
            className={`px-3 py-1 rounded border ${
              s === status ? "border-accent text-accent" : "border-hairline text-muted"
            }`}
          >
            {s}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="py-2">{t("submitted")}</th>
              <th>{t("company")}</th>
              <th>{t("country")}</th>
              <th>{t("type")}</th>
              <th>{t("kyb")}</th>
              <th className="text-right">{t("assets")}</th>
              <th className="text-right">{t("documents")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-hairline">
                <td className="py-2 num">
                  <Link href={`/${locale}/admin/listings/${r.id}`} className="underline">
                    {(r.submittedAt ?? r.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                  </Link>
                </td>
                <td>{r.company.legalName}</td>
                <td className="num">{r.company.country}</td>
                <td>{r.company.type}</td>
                <td>{r.company.kybStatus}</td>
                <td className="text-right num">{r.company._count.assets}</td>
                <td className="text-right num">
                  {Array.isArray(r.documents) ? r.documents.length : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
