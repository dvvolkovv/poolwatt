// §51.5 на телефоне: мои заявки. Тот же читатель, что в кабинете.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { Screen } from "@/components/mobile/screen";
import { listMyTickets } from "@/lib/work/ticket-view";

export const dynamic = "force-dynamic";

export default async function MobileTickets({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/tickets`);
  }

  const t = await getTranslations("tickets");
  const tReport = await getTranslations("report");
  const rows = await listMyTickets(session.user.id);

  return (
    <Screen title={t("mine")} back={`/${locale}/app/more`}>
      {rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">{t("noneOfMine")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-hairline" data-testid="my-tickets">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <Link
                href={`/${locale}/app/tickets/${row.id}`}
                prefetch={false}
                className="block"
              >
                <div className="text-[15px]">{tReport(`type.${row.problemType}`)}</div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {row.pointName && <>{row.pointName} · </>}
                  {t(`status.${row.status}`)}
                  {row.awaitingAnswer && row.status !== "CLOSED" && (
                    <> · {row.overdue ? t("overdue") : t("awaiting")}</>
                  )}
                </div>
                {row.lastMessage && (
                  <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">
                    {row.lastMessage.body}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
