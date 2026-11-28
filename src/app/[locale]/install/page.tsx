// Страница, с которой Poolwatt попадает на телефон. До неё APK лежал на
// отдаче и PWA устанавливался, но ссылки на это с сайта не было ни одной.
//
// Ничего не обещает за внешние стороны: значок на экран кладёт сам браузер,
// APK отдаёт наш nginx, а про TestFlight сказано словами — публичной ссылки
// на него нет, и выдумывать её нельзя.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { readLatestApk } from "@/lib/apk-release";
import { qrSvg } from "@/lib/receipts/receipt-qr";
import { PwaInstallButton } from "@/components/install/pwa-install-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("install");
  return { title: `${t("title")} — Poolwatt`, description: t("subtitle") };
}

type Props = { params: Promise<{ locale: string }> };

export default async function InstallPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("install");

  const apk = readLatestApk();
  const pageUrl = `https://poolwatt.com/${locale}/install`;
  const qr = await qrSvg(pageUrl);

  return (
    <main className="bg-bg">
      <div className="max-w-[1100px] mx-auto px-4 md:px-12 py-10 md:py-16">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
          {t("eyebrow")}
        </div>
        <h1 className="text-[34px] md:text-[56px] leading-[1.02] tracking-[-0.03em] font-black">
          {t("title")}
        </h1>
        <p className="mt-5 max-w-[640px] text-[15px] md:text-[18px] leading-[1.5] font-light text-muted">
          {t("subtitle")}
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {/* PWA — работает на обеих платформах, поэтому стоит первым. */}
          <section className="rounded-2xl border border-hairline p-5 md:p-6">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">
              {t("pwaTitle")}
            </h2>
            <p className="mt-3 text-[14px] leading-[1.55] text-muted">
              {t("pwaBody")}
            </p>
            <div className="mt-5">
              <PwaInstallButton label={t("pwaInstall")} />
            </div>
            <Link
              href={`/${locale}/app`}
              prefetch={false}
              className="mt-4 inline-flex min-h-[44px] items-center text-[13px] font-semibold uppercase tracking-[0.14em] text-accent hover:brightness-110"
            >
              {t("openApp")}
            </Link>
          </section>

          {/* Android — файл, который можно скачать прямо сейчас. */}
          <section className="rounded-2xl border border-hairline p-5 md:p-6">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">
              {t("androidTitle")}
            </h2>
            <p className="mt-3 text-[14px] leading-[1.55] text-muted">
              {t("androidBody")}
            </p>
            {apk ? (
              <>
                <a
                  href={apk.url}
                  className="mt-5 inline-flex min-h-[44px] items-center px-5 rounded-full font-semibold text-[13px] uppercase tracking-[0.16em] bg-accent text-accent-foreground glow-accent transition-all hover:brightness-110"
                >
                  {t("androidDownload")}
                </a>
                <p className="num mt-3 text-[12px] text-muted">
                  {t("androidBuild", { build: apk.build, size: apk.megabytes })}
                </p>
              </>
            ) : (
              <p className="mt-5 text-[14px] text-muted">
                {t("androidMissing")}
              </p>
            )}
          </section>

          {/* iPhone — шаги в Safari, и честная строка про TestFlight. */}
          <section className="rounded-2xl border border-hairline p-5 md:p-6">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">
              {t("iosTitle")}
            </h2>
            <ol className="mt-3 space-y-2 text-[14px] leading-[1.55] text-muted list-decimal pl-5">
              <li>{t("iosStep1")}</li>
              <li>{t("iosStep2")}</li>
              <li>{t("iosStep3")}</li>
            </ol>
            <p className="mt-4 text-[13px] leading-[1.55] text-muted-strong border-t border-hairline pt-4">
              {t("iosTestflight")}
            </p>
          </section>

          {/* QR — чтобы открыть эту же страницу на телефоне с монитора. */}
          <section className="rounded-2xl border border-hairline p-5 md:p-6">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">
              {t("qrTitle")}
            </h2>
            <p className="mt-3 text-[14px] leading-[1.55] text-muted">
              {t("qrBody")}
            </p>
            <div
              className="mt-5 w-[160px] h-[160px] bg-white p-2 rounded-xl [&>svg]:w-full [&>svg]:h-full"
              aria-label={pageUrl}
              role="img"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
