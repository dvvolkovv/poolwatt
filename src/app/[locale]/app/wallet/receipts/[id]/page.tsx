// §46 — тот же документ, что в кабинете, в одну колонку. Своего построителя
// чека здесь нет сознательно: иначе через месяц в кабинете и в телефоне
// будут два разных чека на одну сделку.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";
import { readReceiptDocument } from "@/lib/receipts/receipt-store";
import { ReceiptSheet } from "@/components/receipts/receipt-sheet";
import { Screen } from "@/components/mobile/screen";
import { CorrectionBanner } from "@/components/receipts/correction-banner";
import { readCorrectionJournal } from "@/lib/receipts/receipt-correction";
import { prisma } from "@/lib/prisma";

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

  const doc = await readReceiptDocument(id);
  if (!doc) notFound();

  const t = await getTranslations("app.wallet");
  const tr = await getTranslations("receipt");

  // §46 — какая это версия документа и что в ней поменяли. Тот же компонент,
  // что в кабинете: двух рассказов об одном исправлении быть не должно.
  const chain = await prisma.receipt.findUniqueOrThrow({
    where: { id },
    select: {
      paymentId: true,
      corrects: { select: { id: true, number: true } },
      correctedBy: { select: { id: true, number: true } },
    },
  });
  const journal = await readCorrectionJournal(id);

  return (
    <Screen title={t("receipt")} back={`/${locale}/app/wallet`}>
      <div data-testid="mobile-receipt" className="mt-2">
        <CorrectionBanner
          locale={locale}
          receiptPath={(l, rid) => `/${l}/app/wallet/receipts/${rid}`}
          correctedBy={chain.correctedBy}
          corrects={chain.corrects}
          journal={journal}
          labels={{
            correctedBy: tr("correctedBy", { number: "{number}" }),
            correctsDocument: tr("correctsDocument", { number: "{number}" }),
            journal: tr("journal"),
          }}
        />
        <ReceiptSheet doc={doc} />

        {/* §51.1 — та же кнопка в телефоне. */}
        {chain.paymentId && doc.session?.pointId && (
          <p className="mt-6 text-[14px]">
            <Link
              href={`/${locale}/c/${doc.session.pointId}/report?payment=${chain.paymentId}`}
              prefetch={false}
              data-testid="receipt-report"
              className="text-accent underline"
            >
              {tr("reportProblem")}
            </Link>
          </p>
        )}
      </div>
    </Screen>
  );
}
