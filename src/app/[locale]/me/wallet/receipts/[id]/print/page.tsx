// §46 "печать на терминале станции". A station terminal has a browser and a
// printer and nothing else: it opens this address and the sheet prints itself.

import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";
import { ReceiptSheet } from "@/components/receipts/receipt-sheet";
import { AutoPrint } from "@/components/receipts/auto-print";

export const dynamic = "force-dynamic";

export default async function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/wallet/receipts/${id}/print`);
  }

  const allowed = await readReceiptForUser(id, session.user.id, session.user.role === "ADMIN");
  if (!allowed) notFound();
  const doc = await buildReceiptDocument(id);
  if (!doc) notFound();

  return (
    <div className="py-6" data-testid="receipt-print">
      <AutoPrint />
      <ReceiptSheet doc={doc} />
    </div>
  );
}
