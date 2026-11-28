import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NameSection } from "@/components/settings/name-section";
import { LanguageSection } from "@/components/settings/language-section";
import { EmailSection } from "@/components/settings/email-section";
import { PhoneSection } from "@/components/settings/phone-section";
import { BirthdaySection } from "@/components/settings/birthday-section";
import { PasswordSection } from "@/components/settings/password-section";
import { SetPasswordSection } from "@/components/settings/set-password-section";
import { TalerIdSection } from "@/components/settings/talerid-section";
import { DangerZone } from "@/components/settings/danger-zone";
import { ReceiptDeliverySection } from "@/components/settings/receipt-delivery-section";
import { pushOpen } from "@/lib/exchange/gates";
import { toLocale } from "@/lib/email-i18n";
import { isTalerIdEnabled, TALERID_PROVIDER_ID } from "@/lib/talerid/config";
import { talerIdErrorKey } from "@/lib/talerid/errors";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/settings`);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      username: true,
      name: true,
      email: true,
      emailVerified: true,
      phone: true,
      birthDay: true,
      birthMonth: true,
      preferredLocale: true,
      preferredCurrency: true,
      preferredTheme: true,
      receiptEmail: true,
      receiptPush: true,
      passwordHash: true,
      accounts: { where: { provider: TALERID_PROVIDER_ID }, select: { id: true } },
    },
  });
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations("settings");
  const tCommon = await getTranslations("common");
  const tTalerId = await getTranslations("auth.talerId");
  const hasPassword = user.passwordHash != null;
  const talerIdError = talerIdErrorKey(query.error);

  return (
    <div>
      <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] mb-2">
        {t("title")}
      </h1>
      <p className="text-sm text-muted mb-8">@{user.username}</p>

      <div className="space-y-2">
        <NameSection
          currentName={user.name}
          labels={{
            title: t("name.title"),
            placeholder: t("name.placeholder"),
            submit: t("name.submit"),
            success: t("name.success"),
          }}
        />

        {/* Язык переехал сюда из шапки 2026-11-28 вместе с правом записать
            `preferredLocale`, по которой письма выбирают язык. */}
        <LanguageSection
          // Язык, на котором человек читает страницу прямо сейчас, а не то,
          // что лежит в колонке: до этой страницы колонку нечем было
          // записать, и у всех там стоит «en» по умолчанию. Сохранение
          // сводит их вместе.
          current={toLocale(locale)}
          labels={{
            title: t("language.title"),
            help: t("language.help"),
            submit: tCommon("save"),
          }}
        />

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

        {/* §42 — the birthday gift of the gift constructor. */}
        <BirthdaySection
          currentDay={user.birthDay}
          currentMonth={user.birthMonth}
          labels={{
            title: t("birthday.title"),
            help: t("birthday.help"),
            day: t("birthday.day"),
            month: t("birthday.month"),
            submit: t("birthday.submit"),
            success: t("birthday.success"),
          }}
        />

        <ReceiptDeliverySection
          receiptEmail={user.receiptEmail}
          receiptPush={user.receiptPush}
          pushAvailable={pushOpen()}
          labels={{
            title: t("receipts.title"),
            hint: t("receipts.hint"),
            email: t("receipts.email"),
            push: t("receipts.push"),
            pushClosed: t("receipts.pushClosed"),
            submit: t("receipts.submit"),
            success: t("receipts.success"),
          }}
        />

        {isTalerIdEnabled() && (
          <TalerIdSection
            locale={locale}
            linked={user.accounts.length > 0}
            hasPassword={hasPassword}
            justLinked={query.talerid === "linked"}
            error={talerIdError && tTalerId(`errors.${talerIdError}`)}
            labels={{
              title: t("talerId.title"),
              linked: t("talerId.linked"),
              notLinked: t("talerId.notLinked"),
              link: t("talerId.link"),
              linkPending: tTalerId("pending"),
              unlink: t("talerId.unlink"),
              unlinking: t("talerId.unlinking"),
              needsPassword: t("talerId.needsPassword"),
              linkedNotice: t("talerId.linkedNotice"),
            }}
          />
        )}

        {hasPassword ? (
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
        ) : (
          <SetPasswordSection
            username={user.username}
            labels={{
              title: t("setPassword.title"),
              note: t("setPassword.note"),
              newLabel: t("setPassword.newLabel"),
              submit: t("setPassword.submit"),
              submitting: t("setPassword.submitting"),
            }}
          />
        )}

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
