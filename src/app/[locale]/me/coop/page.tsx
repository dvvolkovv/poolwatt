// US-10 — the cooperatives this person is in. The door to the shares and the
// votes, which until now existed only as API methods.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readMyCooperatives } from "@/lib/exchange/coop-service";

export const dynamic = "force-dynamic";

export default async function CoopListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/coop`);

  const t = await getTranslations("coop");
  const coops = await readMyCooperatives(session.user.id);

  return (
    <div className="max-w-2xl">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("listTitle")}</h1>
      <p className="mb-8 text-sm text-muted">{t("listIntro")}</p>

      {coops.length === 0 ? (
        <p className="text-sm text-muted" data-testid="coop-empty">
          {t("noMemberships")}
        </p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="coop-list">
          {coops.map((c) => (
            <li key={c.coopId} className="flex flex-wrap items-baseline justify-between gap-3 py-4">
              <Link
                href={`/${locale}/me/coop/${c.coopId}`}
                prefetch={false}
                className="text-[15px] font-medium underline hover:text-accent"
              >
                {c.coopName}
              </Link>
              <span className="text-[12px] text-muted">
                {c.zoneCode} · <span className="num">{c.shares}</span> {t("shares")}
                {c.sharePercent != null && (
                  <>
                    {" ("}
                    <span className="num">{c.sharePercent}</span>%{")"}
                  </>
                )}
                {c.openVotes > 0 && (
                  <>
                    {" · "}
                    <span className="text-accent">
                      <span className="num">{c.openVotes}</span> {t("openVotes")}
                    </span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
