// §42 — the link a QR sticker on the charger carries. The driver scans it,
// signs in if they have to, and the gift is theirs.
//
// The page is the one place the code is redeemed without typing: the form
// below is there for the second attempt, when the code was already used or
// the campaign is over, so the person is not left on a dead end.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PromoCodeForm } from "@/components/marketing/promo-code-form";
import { normalizePromoCode, redeemPromoCode } from "@/lib/marketing/promo-code";

export const dynamic = "force-dynamic";

export default async function PromoPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);

  const code = normalizePromoCode(decodeURIComponent(raw));
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/promo/${encodeURIComponent(code)}`);
  }

  const t = await getTranslations("gifts");

  let message: string | null = null;
  let failure: string | null = null;
  try {
    const redeemed = await redeemPromoCode(session.user.id, code);
    message = t("codeDone", { network: redeemed.networkName });
  } catch (err) {
    failure = err instanceof Error ? err.message : "That code did not work.";
  }

  return (
    <div className="max-w-xl">
      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("codeTitle")}</h1>
      <p className="mb-4 text-sm text-muted">
        <code>{code}</code>
      </p>

      {message && (
        <p className="text-[15px] text-up" data-testid="promo-landing-done">
          {message}
        </p>
      )}
      {failure && (
        <p className="text-[15px] text-down" data-testid="promo-landing-error">
          {failure}
        </p>
      )}

      <PromoCodeForm
        labels={{
          title: t("codeTitle"),
          field: t("codeField"),
          submit: t("codeSubmit"),
          done: t("codeDone", { network: "{network}" }),
        }}
      />

      <p className="mt-6 text-[13px]">
        <Link href={`/${locale}/me/gifts`} prefetch={false} className="underline hover:text-accent">
          {t("title")} →
        </Link>
      </p>
    </div>
  );
}
