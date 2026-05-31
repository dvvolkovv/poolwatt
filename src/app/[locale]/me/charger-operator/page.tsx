import { redirect } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ChargerOperatorListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator`);

  const operators = await prisma.chargerOperator.findMany({
    where: { claimedById: session.user.id },
    orderBy: { displayName: "asc" },
    select: { id: true, slug: true, displayName: true },
  });

  const t = await getTranslations("cabinet.chargerOperator");

  return (
    <div className="max-w-2xl">
      <h1 className="text-[28px] font-bold mb-6">{t("listTitle")}</h1>
      {operators.length === 0 ? (
        <div className="bg-card border border-hairline rounded-xl p-8">
          <p className="text-sm text-muted mb-4">{t("emptyState")}</p>
          <Link href={`/${locale}/navigator`} className="text-sm text-accent hover:underline">{t("emptyStateCta")} →</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {operators.map((op) => (
            <li key={op.id}>
              <Link href={`/${locale}/me/charger-operator/${op.id}`}
                className="block p-4 bg-card border border-hairline rounded-xl hover:border-accent/40 transition-colors">
                <div className="font-semibold">{op.displayName}</div>
                <div className="text-xs text-muted mt-1">@{op.slug}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
