// §51.5 — «клиент видит статус заявки». До этой работы заявку, отправленную
// с карточки станции, человек не видел никогда и нигде.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { listMyTickets } from "@/lib/work/ticket-view";

export const dynamic = "force-dynamic";

export default async function MyTicketsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/tickets`);
  }

  const t = await getTranslations("tickets");
  const tReport = await getTranslations("report");
  const rows = await listMyTickets(session.user.id);

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{t("mine")}</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("noneOfMine")}</p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="my-tickets">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <Link
                href={`/${locale}/me/tickets/${row.id}`}
                prefetch={false}
                className="block hover:text-accent"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">
                    {tReport(`type.${row.problemType}`)}
                    {row.pointName && <span className="text-muted"> · {row.pointName}</span>}
                  </span>
                  <span className="text-[12px] text-muted">
                    {t(`status.${row.status}`)}
                    {row.awaitingAnswer && row.status !== "CLOSED" && (
                      <> · {row.overdue ? t("overdue") : t("awaiting")}</>
                    )}
                  </span>
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
    </div>
  );
}
