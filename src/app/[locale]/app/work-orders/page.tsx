// §48 на телефоне — мои наряды. US-48 закрыта страницей кабинета; «в
// приложении» из её формулировки — это здесь, и отсюда инженер уходит в
// списание запчасти US-49.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readEngineerOrders } from "@/lib/warehouse/engineer-view";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

export default async function MobileWorkOrders({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/work-orders`);
  }

  const t = await getTranslations("app.work");
  const tOrders = await getTranslations("workOrders");
  const orders = await readEngineerOrders(session.user.id);

  return (
    <Screen title={t("title")} back={`/${locale}/app/more`}>
      {orders.length === 0 ? (
        <p className="mt-4 text-[14px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-hairline" data-testid="mobile-work-order-list">
          {orders.map((o) => (
            <li key={o.id} className="py-3">
              <Link
                href={`/${locale}/app/work-orders/${o.id}`}
                prefetch={false}
                className="text-[15px]"
              >
                {o.title}
              </Link>
              <p className="mt-0.5 text-[12px] text-muted">
                {tOrders(`priority.${o.priority}`)} · {tOrders(`status.${o.status}`)}
              </p>
              {o.where && <p className="mt-0.5 text-[12px] text-muted">{o.where}</p>}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
