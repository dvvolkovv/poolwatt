import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getChargerById } from "@/lib/chargers-mock";
import { auth } from "@/lib/auth";
import { readFavoriteChargerIds } from "@/lib/favorites";
import { FavoriteButton } from "@/components/favorite-button";
import { MapsDeepLink } from "@/components/maps-deep-link";

const STATUS_COLOR: Record<string, string> = {
  operational: "bg-up",
  planned: "bg-muted",
  temporarily_unavailable: "bg-down",
  removed: "bg-down",
};

export default async function ChargerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const charger = getChargerById(id);
  if (!charger) notFound();

  const t = await getTranslations("charger");
  const session = await auth();
  const isFavorite = session?.user
    ? (await readFavoriteChargerIds(session.user.id)).has(charger.id)
    : false;

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1000px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className="flex items-center justify-between mb-6">
          <Link
            href={`/${locale}/navigator`}
            className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            ‹ {t("backToNavigator")}
          </Link>
          <FavoriteButton
            kind="charger"
            id={charger.id}
            initial={isFavorite}
            signedIn={!!session?.user}
            label={{ add: t("favoriteAdd"), remove: t("favoriteRemove") }}
          />
        </div>

        <header className="mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] mb-3">
            <span
              className={
                "w-2 h-2 rounded-full " + (STATUS_COLOR[charger.status] ?? "bg-muted")
              }
              aria-hidden
            />
            <span className="text-muted">{t(`status.${charger.status}`)}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">{charger.operator}</span>
          </div>
          <h1 className="text-[28px] md:text-[40px] font-bold tracking-[-0.025em] leading-tight">
            {charger.title}
          </h1>
          <p className="mt-3 text-muted text-[14px]">
            {charger.address}, {charger.city}, {charger.country}
          </p>
        </header>

        <div className="mb-10">
          <MapsDeepLink
            lat={charger.lat}
            lng={charger.lng}
            name={charger.title}
            label={t("buildRoute")}
          />
          <p className="mt-2 text-[11px] text-muted">{t("buildRouteHint")}</p>
        </div>

        <section className="mb-10">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4">
            {t("connectorsTitle")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {charger.connections.map((c, i) => (
              <div
                key={i}
                className="border border-hairline rounded-lg p-4 bg-card flex items-center justify-between"
              >
                <div>
                  <div className="text-[15px] font-semibold">{c.connectorType}</div>
                  <div className="text-[12px] text-muted">
                    {c.currentType}
                    {c.voltageV ? ` · ${c.voltageV} V` : ""}
                    {c.ampereA ? ` · ${c.ampereA} A` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[18px] font-bold num">{c.powerKw} kW</div>
                  <div className="text-[11px] text-muted num">× {c.quantity}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-[14px]">
          <Field label={t("totalPoints")} value={String(charger.totalPoints)} />
          <Field label={t("maxPower")} value={`${charger.maxPowerKw} kW`} />
          <Field label={t("usageType")} value={t(`usage.${charger.usageType}`)} />
          {charger.openHours && <Field label={t("openHours")} value={charger.openHours} />}
          {charger.costInfo && <Field label={t("costInfo")} value={charger.costInfo} />}
          {typeof charger.rating === "number" && (
            <Field label={t("rating")} value={`★ ${charger.rating.toFixed(1)}`} />
          )}
        </section>

        <section className="border-t border-hairline pt-6 text-[12px] text-muted">
          <span>{t("lastVerified")}: </span>
          <span className="num text-muted-strong">{charger.lastVerified ?? "—"}</span>
        </section>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}
