// §22.2 "Главный экран" — balance big, money under it, the §20 badge, the
// price in the zone, four quick buttons. US-17 asks for a balance that
// updates by itself; M2 attaches the wallet socket, M1 shows the figure the
// server read and leaves it in localStorage for the offline screen.

import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { roundPrice } from "@/lib/exchange/precision";
import { readShellContext } from "@/lib/mobile/shell-context";
import { QuickActions } from "@/components/mobile/quick-actions";
import { BalanceCache } from "@/components/mobile/balance-cache";

export const dynamic = "force-dynamic";

export default async function MobileHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.home");
  const tStatus = await getTranslations("app.status");

  const session = await auth();
  const root = `/${locale}/app`;

  if (!session?.user) {
    return (
      <div className="px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-28">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
          {t("guestTitle")}
        </h1>
        <p className="text-[14px] text-muted mt-2">{t("guestBody")}</p>
        <Link
          href={`/${locale}/register`}
          className="mt-6 block rounded-md bg-accent text-accent-foreground
                     py-3 text-center font-semibold"
        >
          {t("signUp")}
        </Link>
        <Link
          href={`/${locale}/login?callbackUrl=${root}`}
          className="mt-3 block rounded-md border border-hairline py-3 text-center"
        >
          {t("signIn")}
        </Link>
      </div>
    );
  }

  const ctx = await readShellContext(session.user.id);
  const zoneCode = ctx.primary?.zoneCode ?? null;
  const zone = zoneCode
    ? await prisma.gridZone.findUnique({
        where: { code: zoneCode },
        select: { code: true, currency: true, spotPrice: true },
      })
    : null;
  const spot = zone?.spotPrice != null ? roundPrice(num(zone.spotPrice)) : null;

  return (
    <div className="px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-28">
      <BalanceCache
        kwh={ctx.totalKwh}
        fiat={ctx.primary?.fiatBalance ?? 0}
        currency={ctx.primary?.currency ?? "EUR"}
        zoneCode={zoneCode}
      />

      <div className="flex items-center justify-between">
        <span
          data-testid="status-badge"
          className="text-[10px] uppercase tracking-[0.18em] text-accent
                     border border-accent/40 rounded-sm px-2 py-0.5"
        >
          {tStatus(ctx.status)}
        </span>
        <Link href={`${root}/profile`} className="text-[13px] text-muted">
          @{session.user.username}
        </Link>
      </div>

      <div className="mt-6">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
          {t("balance")}
        </div>
        <div
          data-testid="kwh-balance"
          className="num text-[52px] font-semibold leading-none mt-1"
        >
          {ctx.totalKwh.toFixed(2)}
          <span className="text-[18px] text-muted ml-2">kWh</span>
        </div>
        <div className="num text-[16px] text-muted-strong mt-3">
          {(ctx.primary?.fiatBalance ?? 0).toFixed(2)} {ctx.primary?.currency ?? "EUR"}
          <span className="text-[13px] text-muted ml-2">{t("money")}</span>
        </div>
      </div>

      {spot != null && zone && (
        <div className="mt-5 rounded-lg bg-card border border-hairline px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {t("zonePrice", { zone: zone.code })}
          </div>
          <div className="num text-[20px] mt-1">
            {spot.toFixed(4)} {zone.currency}/kWh
          </div>
        </div>
      )}

      <QuickActions
        actions={[
          { key: "buy", label: t("buy"), href: `${root}/wallet`, glyph: "＋" },
          { key: "transfer", label: t("transfer"), href: `${root}/contacts`, glyph: "→" },
          { key: "charge", label: t("charge"), href: `${root}/charge`, glyph: "⌁" },
          { key: "topUp", label: t("topUp"), href: `${root}/account`, glyph: "⇅" },
        ]}
      />
    </div>
  );
}
