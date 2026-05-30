import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmailSection } from "@/components/settings/email-section";
import { PhoneSection } from "@/components/settings/phone-section";
import { PasswordSection } from "@/components/settings/password-section";
import { DangerZone } from "@/components/settings/danger-zone";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/settings`);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      username: true,
      email: true,
      emailVerified: true,
      phone: true,
      preferredLocale: true,
      preferredCurrency: true,
      preferredTheme: true,
    },
  });
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations("settings");

  return (
    <div>
      <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] mb-2">
        {t("title")}
      </h1>
      <p className="text-sm text-muted mb-8">@{user.username}</p>

      <div className="space-y-2">
        <EmailSection
          currentEmail={user.email}
          emailVerified={user.emailVerified != null}
          labels={{
            title: t("email.title"),
            none: t("email.none"),
            pendingNote: t("email.pendingNote"),
            addLabel: t("email.addLabel"),
            addPlaceholder: t("email.addPlaceholder"),
            submit: t("email.submit"),
            submitting: t("email.submitting"),
            successPending: t("email.successPending"),
          }}
        />

        <PhoneSection
          currentPhone={user.phone}
          labels={{
            title: t("phone.title"),
            placeholder: t("phone.placeholder"),
            submit: t("phone.submit"),
            success: t("phone.success"),
          }}
        />

        <PasswordSection
          labels={{
            title: t("password.title"),
            currentLabel: t("password.currentLabel"),
            newLabel: t("password.newLabel"),
            submit: t("password.submit"),
            submitting: t("password.submitting"),
            success: t("password.success"),
          }}
        />

        <DangerZone
          username={user.username}
          labels={{
            title: t("danger.title"),
            warning: t("danger.warning"),
            confirmLabel: t("danger.confirmLabel"),
            submit: t("danger.submit"),
            submitting: t("danger.submitting"),
          }}
        />
      </div>
    </div>
  );
}
