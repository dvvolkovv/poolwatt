// US-42 — "хочу видеть свои подарки и где их потратить". §43 asks for them to
// be shown apart from the kWh balance, with the partner, the amount and the
// date, because they are not the same kind of thing.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readMyGifts } from "@/lib/marketing/grant-spend";

export const dynamic = "force-dynamic";

export default async function GiftsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/gifts`);

  const t = await getTranslations("gifts");
  const gifts = await readMyGifts(session.user.id);

  const totalKwh = gifts.reduce((sum, g) => sum + g.remainingKwh, 0);

  return (
    <div className="max-w-2xl">
      <Link
        href={`/${locale}/me/wallet`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("backToWallet")}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-8 text-sm text-muted">{t("intro")}</p>

      {gifts.length === 0 ? (
        <p className="text-sm text-muted" data-testid="gifts-empty">
          {t("empty")}
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm">
            {t("total")}: <span className="num font-semibold">{totalKwh}</span> {t("kwh")}
          </p>
          <ul className="divide-y divide-hairline" data-testid="gift-list">
            {gifts.map((g) => (
              <li key={g.id} className="space-y-1.5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium">{g.networkName}</span>
                  <span className="text-[15px]">
                    <span className="num font-semibold">{g.remainingKwh}</span> {t("kwh")}
                  </span>
                </div>
                <div className="text-[12px] text-muted">
                  {g.campaignName}
                  {" · "}
                  {t("until")} {g.expiresAt.toISOString().slice(0, 10)}
                  {g.remainingKwh < g.amountKwh && (
                    <>
                      {" · "}
                      {t("of")} <span className="num">{g.amountKwh}</span>
                    </>
                  )}
                </div>
                <p className="text-[12px] text-muted">{t("onlyHere", { network: g.networkName })}</p>
                <Link
                  href={`/${locale}/navigator?q=${encodeURIComponent(g.networkName)}`}
                  prefetch={false}
                  data-testid="show-stations"
                  className="inline-block rounded border border-accent px-3 py-1 text-[12px] text-accent hover:bg-accent/10"
                >
                  {t("showStations")} (<span className="num">{g.pointCount}</span>)
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
