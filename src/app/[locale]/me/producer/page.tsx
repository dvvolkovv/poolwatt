import { redirect } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ProducerListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/producer`);

  const producers = await prisma.producer.findMany({
    where: { claimedById: session.user.id },
    orderBy: { displayName: "asc" },
    select: { id: true, handle: true, displayName: true, country: true, primarySource: true },
  });

  const t = await getTranslations("cabinet.producer");

  return (
    <div className="max-w-2xl">
      <h1 className="text-[28px] font-bold mb-6">{t("listTitle")}</h1>

      {producers.length === 0 ? (
        <div className="bg-card border border-hairline rounded-xl p-8">
          <p className="text-sm text-muted mb-4">{t("emptyState")}</p>
          <Link
            href={`/${locale}`}
            className="text-sm text-accent hover:underline"
          >
            {t("emptyStateCta")} →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {producers.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${locale}/me/producer/${p.id}`}
                className="block p-4 bg-card border border-hairline rounded-xl hover:border-accent/40 transition-colors"
              >
                <div className="font-semibold">{p.displayName}</div>
                <div className="text-xs text-muted mt-1">
                  @{p.handle} · {p.primarySource} · {p.country}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
