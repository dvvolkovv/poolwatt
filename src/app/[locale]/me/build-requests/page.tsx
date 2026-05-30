import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function BuildRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests`);

  const requests = await prisma.buildRequest.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, source: true, peakKw: true, country: true, city: true,
      status: true, createdAt: true,
    },
  });

  const t = await getTranslations("cabinet.buildRequest");

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <Link
          href={`/${locale}/me/build-requests/new`}
          className="px-4 py-2 bg-foreground text-bg rounded text-sm"
        >
          {t("action.newRequest")}
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {requests.map((r) => (
            <li key={r.id} className="py-4">
              <Link
                href={`/${locale}/me/build-requests/${r.id}`}
                className="flex justify-between items-center hover:opacity-80"
              >
                <div>
                  <div className="font-medium">
                    {t(`field.source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
                  </div>
                  <div className="text-sm text-muted">
                    {r.city}, {r.country} · {r.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${statusClass(r.status)}`}>
                  {t(`status.${r.status}`)}
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
    case "OPEN": return "bg-blue-100 text-blue-700";
    case "MATCHED": return "bg-yellow-100 text-yellow-700";
    case "FULFILLED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
