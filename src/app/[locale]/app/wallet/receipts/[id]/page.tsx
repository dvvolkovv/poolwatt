// §46 — тот же документ, что в кабинете, в одну колонку. Своего построителя
// чека здесь нет сознательно: иначе через месяц в кабинете и в телефоне
// будут два разных чека на одну сделку.

import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";
import { ReceiptSheet } from "@/components/receipts/receipt-sheet";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

export default async function MobileReceiptScreen({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/wallet/receipts/${id}`);
  }

  // Доступ раньше состава: документ §46 тянет реквизиты сети, и ничего из
  // этого не должно утечь в чужой чек.
  const allowed = await readReceiptForUser(id, session.user.id, session.user.role === "ADMIN");
  if (!allowed) notFound();

  const doc = await buildReceiptDocument(id);
  if (!doc) notFound();

  const t = await getTranslations("app.wallet");

  return (
    <Screen title={t("receipt")} back={`/${locale}/app/wallet`}>
      <div data-testid="mobile-receipt" className="mt-2">
        <ReceiptSheet doc={doc} />
      </div>
    </Screen>
  );
}
