// Assets and monitoring — ТЗ §4, §12 US-03, §30.
//
// "Первые показания видны в кабинете в течение 15 минут": this page reads
// MeterReading directly, so a reading is visible the moment it is accepted.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AssetForm } from "@/components/listing/asset-form";
import { AssetKeys } from "@/components/listing/asset-keys";
import { SaleRulesForm } from "@/components/listing/sale-rules-form";
import { num } from "@/lib/exchange/decimal";
import { prisma } from "@/lib/prisma";

const READINGS_PER_ASSET = 24;

const stamp = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 16).replace("T", " ") : null;

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ locale: string; companyId: string }>;
}) {
  const { locale, companyId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/listing/${companyId}/assets`);
  }

  const t = await getTranslations("cabinet.listing");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, legalName: true, ownerUserId: true },
  });
  if (!company) notFound();
  if (company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") notFound();

  const [assets, zones] = await Promise.all([
    prisma.asset.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      include: {
        gridZone: { select: { code: true, name: true, intervalMinutes: true } },
        apiKeys: { orderBy: { createdAt: "desc" } },
        readings: { orderBy: { intervalStart: "desc" }, take: READINGS_PER_ASSET },
      },
    }),
    prisma.gridZone.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const kindNames = {
    SOLAR: t("assets.kind.SOLAR"),
    WIND: t("assets.kind.WIND"),
    BIOGAS: t("assets.kind.BIOGAS"),
    HYDRO: t("assets.kind.HYDRO"),
    STORAGE: t("assets.kind.STORAGE"),
    MIXED: t("assets.kind.MIXED"),
  };

  return (
    <div>
      <Link
        href={`/${locale}/me/listing/${companyId}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {company.legalName}
      </Link>

      <h1 className="mb-2 mt-3 text-[28px] font-bold">{t("assets.title")}</h1>
      <p className="mb-8 max-w-[70ch] text-sm text-muted">{t("assets.intro")}</p>

      {assets.length === 0 && <p className="mb-6 text-sm text-muted">{t("assets.empty")}</p>}

      <div className="mb-8 space-y-8">
        {assets.map((a) => (
          <section key={a.id} className="rounded-lg border border-hairline p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[18px] font-semibold">
                {a.name}{" "}
                <span className="text-[13px] font-normal text-muted">
                  · {kindNames[a.kind]}
                </span>
              </h2>
              <span className="flex items-baseline gap-3">
                <Link
                  href={`/${locale}/me/listing/${companyId}/assets/${a.id}`}
                  prefetch={false}
                  className="text-[13px] text-accent underline"
                >
                  {t("assets.console")}
                </Link>
                <span className="num text-[12px] text-muted">
                  {a.gridZone.code} · {a.gridZone.intervalMinutes} min
                </span>
              </span>
            </div>

            <dl className="mb-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Field label={t("assets.statusLabel")} value={t(`assets.status.${a.status}`)} />
              <Field label={t("assets.capacity")} value={`${num(a.capacityKw).toFixed(3)} kW`} />
              <Field label={t("assets.cleanSince")} value={stamp(a.telemetryCleanSince) ?? "—"} />
              <Field label={t("assets.activatedAt")} value={stamp(a.activatedAt) ?? "—"} />
              {a.meterId && <Field label={t("assets.meter")} value={a.meterId} />}
            </dl>

            <div className="mb-6">
              <AssetKeys
                assetId={a.id}
                keys={a.apiKeys.map((k) => ({
                  id: k.id,
                  prefix: k.prefix,
                  label: k.label,
                  lastUsedAt: stamp(k.lastUsedAt),
                  revokedAt: stamp(k.revokedAt),
                  signs: k.signingSecretEnc !== null,
                }))}
                labels={{
                  keys: t("assets.keys"),
                  keysHelp: t("assets.keysHelp", { assetId: a.id }),
                  noKeys: t("assets.noKeys"),
                  issueKey: t("assets.issueKey"),
                  issuing: t("assets.issuing"),
                  keyLabel: t("assets.keyLabel"),
                  revoke: t("assets.revoke"),
                  revoked: t("assets.revoked"),
                  lastUsed: t("assets.lastUsed"),
                  never: t("assets.never"),
                  keyOnce: t("assets.keyOnce"),
                  secretOnce: t("assets.secretOnce"),
                  signing: t("assets.signing"),
                  signed: t("assets.signed"),
                  unsigned: t("assets.unsigned"),
                }}
              />
            </div>

            <div className="mb-6">
              <SaleRulesForm
                assetId={a.id}
                initial={{
                  minSalePrice: a.minSalePrice ? num(a.minSalePrice) : null,
                  shareToMarketPct: a.shareToMarketPct,
                  shareToStoragePct: a.shareToStoragePct,
                  shareToSelfPct: a.shareToSelfPct,
                  reserveSocPct: a.reserveSocPct,
                }}
                canStore={a.kind === "STORAGE" || a.kind === "MIXED"}
                labels={{
                  rules: t("assets.rules"),
                  rulesHelp: t("assets.rulesHelp"),
                  minSalePrice: t("assets.minSalePrice"),
                  shareToMarket: t("assets.shareToMarket"),
                  shareToStorage: t("assets.shareToStorage"),
                  shareToSelf: t("assets.shareToSelf"),
                  reserveSoc: t("assets.reserveSoc"),
                  saveRules: t("assets.saveRules"),
                  saving: t("form.saving"),
                  saved: t("assets.saved"),
                }}
              />
            </div>

            <div>
              <h4 className="mb-2 text-[12px] uppercase tracking-[0.14em] text-muted">
                {t("assets.readings")}
              </h4>
              {a.readings.length === 0 ? (
                <p className="text-[13px] text-muted">{t("assets.noReadings")}</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline text-left text-muted">
                      <th className="py-1.5 font-normal">{t("assets.interval")}</th>
                      <th className="text-right font-normal">{t("assets.energy")}</th>
                      <th className="font-normal">{t("assets.validation")}</th>
                      <th className="font-normal">{t("assets.minted")}</th>
                      <th className="font-normal">{t("assets.note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.readings.map((r) => (
                      <tr key={r.id} className="border-b border-hairline">
                        <td className="num py-1.5">{stamp(r.intervalStart)}</td>
                        <td className="num text-right">{num(r.energyKwh).toFixed(3)}</td>
                        <td>{t(`assets.validationStatus.${r.validationStatus}`)}</td>
                        <td className="num">{stamp(r.mintedAt) ?? "—"}</td>
                        <td className="text-muted">{r.validationNote ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        ))}
      </div>

      {zones.length > 0 && (
        <AssetForm
          companyId={companyId}
          zones={zones}
          labels={{
            newAsset: t("assets.newAsset"),
            title: t("assets.form.title"),
            kind: t("assets.form.kind"),
            name: t("assets.form.name"),
            capacityKw: t("assets.form.capacityKw"),
            storageKwh: t("assets.form.storageKwh"),
            address: t("assets.form.address"),
            latitude: t("assets.form.latitude"),
            longitude: t("assets.form.longitude"),
            zone: t("assets.form.zone"),
            meterId: t("assets.form.meterId"),
            goCertificateRef: t("assets.form.goCertificateRef"),
            submit: t("assets.form.submit"),
            cancel: t("assets.form.cancel"),
            saving: t("assets.form.saving"),
            kindNames,
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="num mt-0.5">{value}</dd>
    </div>
  );
}
