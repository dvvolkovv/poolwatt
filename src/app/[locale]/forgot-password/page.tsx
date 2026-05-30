import { setRequestLocale, getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("forgotPassword");

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <ForgotPasswordForm
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          identifierLabel: t("identifierLabel"),
          identifierPlaceholder: t("identifierPlaceholder"),
          submit: t("submit"),
          submitting: t("submitting"),
          success: t("success"),
          noEmail: t("noEmail"),
          unknown: t("unknown"),
          backToLogin: t("backToLogin"),
        }}
      />
    </main>
  );
}
