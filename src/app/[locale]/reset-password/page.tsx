import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { ResetPasswordForm } from "@/components/reset-password-form";
import Link from "next/link";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("resetPassword");

  if (!token) {
    return (
      <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-3">
            {t("missing.title")}
          </h1>
          <p className="text-sm text-muted">{t("missing.body")}</p>
          <Link
            href={`/${locale}/forgot-password`}
            className="mt-6 inline-block text-accent hover:underline text-sm"
          >
            {t("missing.cta")}
          </Link>
        </div>
      </main>
    );
  }

  // Look up the token to fail fast on bad/expired links; the actual password
  // update is performed inside the form's server action.
  const rec = await prisma.passwordResetToken.findUnique({
    where: { token },
  });
  const expired =
    !rec || rec.usedAt != null || rec.expiresAt.getTime() < Date.now();

  if (expired) {
    return (
      <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-3">
            {t("expired.title")}
          </h1>
          <p className="text-sm text-muted">{t("expired.body")}</p>
          <Link
            href={`/${locale}/forgot-password`}
            className="mt-6 inline-block text-accent hover:underline text-sm"
          >
            {t("expired.cta")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <ResetPasswordForm
        token={token}
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          newLabel: t("newLabel"),
          submit: t("submit"),
          submitting: t("submitting"),
          success: t("success"),
          backToLogin: t("backToLogin"),
        }}
      />
    </main>
  );
}
