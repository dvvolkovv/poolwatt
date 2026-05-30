import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ContractorListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor`);

  const memberships = await prisma.contractorMember.findMany({
    where: { userId: session.user.id },
    orderBy: { addedAt: "desc" },
    include: {
      contractor: {
        select: {
          id: true, slug: true, displayName: true, country: true, city: true,
          status: true, entityType: true, createdAt: true,
        },
      },
    },
  });

  const t = await getTranslations("cabinet.contractor");

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <Link
          href={`/${locale}/me/contractor/new`}
          className="px-4 py-2 bg-foreground text-bg rounded text-sm"
        >
          {t("action.newContractor")}
        </Link>
      </div>

      {memberships.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {memberships.map((m) => (
            <li key={m.contractorId} className="py-4">
              <Link
                href={`/${locale}/me/contractor/${m.contractorId}`}
                className="flex justify-between items-center hover:opacity-80"
              >
                <div>
                  <div className="font-medium">{m.contractor.displayName}</div>
                  <div className="text-sm text-muted">
                    {m.contractor.city}, {m.contractor.country} · {t(`field.entityType.${m.contractor.entityType}`)} · {m.contractor.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${statusClass(m.contractor.status)}`}>
                  {t(`status.${m.contractor.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "PENDING": return "bg-yellow-100 text-yellow-700";
    case "APPROVED": return "bg-green-100 text-green-700";
    case "REJECTED": return "bg-gray-100 text-gray-700";
    case "SUSPENDED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
