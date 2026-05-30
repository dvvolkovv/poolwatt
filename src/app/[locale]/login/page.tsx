import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { auth } from "@/lib/auth";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (session?.user) redirect(`/${locale}/me`);

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
      />
    </main>
  );
}
