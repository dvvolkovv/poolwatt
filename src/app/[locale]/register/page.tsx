import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/register-form";
import { auth } from "@/lib/auth";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (session?.user) redirect(`/${locale}/me`);

  const t = await getTranslations("auth.register");

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <RegisterForm
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          usernameLabel: t("usernameLabel"),
          usernamePlaceholder: t("usernamePlaceholder"),
          passwordLabel: t("passwordLabel"),
          passwordPlaceholder: t("passwordPlaceholder"),
          submit: t("submit"),
          submitting: t("submitting"),
          haveAccount: t("haveAccount"),
          signIn: t("signIn"),
          emailNote: t("emailNote"),
        }}
      />
    </main>
  );
}
