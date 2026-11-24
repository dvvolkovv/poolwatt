import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { TalerIdPanel } from "@/components/talerid-panel";
import { auth } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { talerIdErrorKey } from "@/lib/talerid/errors";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const { error, callbackUrl } = await searchParams;
  setRequestLocale(locale);

  const errorKey = talerIdErrorKey(error);
  const session = await auth();
  if (session?.user) {
    // Auth.js sends every failure here, including a failed link from settings.
    redirect(
      errorKey
        ? `/${locale}/me/settings?error=${encodeURIComponent(String(error))}`
        : `/${locale}/me`,
    );
  }

  const t = await getTranslations("auth.login");

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <LoginForm
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          usernameLabel: t("usernameLabel"),
          usernamePlaceholder: t("usernamePlaceholder"),
          passwordLabel: t("passwordLabel"),
          passwordPlaceholder: t("passwordPlaceholder"),
          submit: t("submit"),
          submitting: t("submitting"),
          noAccount: t("noAccount"),
          register: t("register"),
          forgotPassword: t("forgotPassword"),
        }}
      >
        <TalerIdPanel
          locale={locale}
          mode="signIn"
          callbackUrl={safeRedirectPath(
            typeof callbackUrl === "string" ? callbackUrl : null,
            `/${locale}/me`,
          )}
          errorKey={errorKey}
        />
      </LoginForm>
    </main>
  );
}
