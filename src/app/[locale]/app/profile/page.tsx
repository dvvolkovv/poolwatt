// §22.11 «Профиль и настройки». На M4 здесь появилось то, что относится к
// §25: привязка этого устройства для подтверждения операций. Остальное —
// локали, уведомления, статус §20 — этап M5.

import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { Screen } from "@/components/mobile/screen";
import { Soon } from "@/components/mobile/soon";
import { DeviceKeys } from "@/components/mobile/device-key-button";

export const dynamic = "force-dynamic";

export default async function ProfileScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.tabs");
  const tDev = await getTranslations("app.devices");
  const session = await auth();

  return (
    <Screen title={t("profile")}>
      {session?.user ? (
        <>
          <p className="mt-2 text-[15px]" data-testid="profile-username">
            {session.user.name ?? session.user.username}
          </p>
          <DeviceKeys
            labels={{
              title: tDev("title"),
              link: tDev("link"),
              linking: tDev("linking"),
              linked: tDev("linked"),
              unsupported: tDev("unsupported"),
              none: tDev("none"),
              forget: tDev("forget"),
              lastUsed: tDev("lastUsed"),
              never: tDev("never"),
              why: tDev("why"),
            }}
          />
        </>
      ) : (
        <Link
          href={`/${locale}/login?callbackUrl=/${locale}/app/profile`}
          className="mt-4 block rounded-lg border border-hairline px-4 py-3 text-center text-[14px]"
        >
          {t("profile")}
        </Link>
      )}
      <div className="mt-8">
        <Soon stage="M5" />
      </div>
    </Screen>
  );
}
