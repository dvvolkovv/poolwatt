// The receipt a buyer opens from the wallet history — ТЗ §46, US-07, US-45.
// A receipt that is not yours does not exist here.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";
import { ReceiptSheet } from "@/components/receipts/receipt-sheet";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/wallet/receipts/${id}`);
  }

  // Access first, composition second: the §46 document pulls in the network's
  // requisites, and none of that may leak to somebody else's receipt.
  const allowed = await readReceiptForUser(id, session.user.id, session.user.role === "ADMIN");
  if (!allowed) notFound();

  const doc = await buildReceiptDocument(id);
  if (!doc) notFound();

  const t = await getTranslations("receipt");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between" data-print-hide>
        <Link
          href={`/${locale}/me/wallet`}
          prefetch={false}
          className="text-[12px] text-muted underline hover:text-foreground"
        >
          ← {t("back")}
        </Link>
        <Link
          href={`/${locale}/me/wallet/receipts/${id}/print`}
          prefetch={false}
          className="rounded-md border border-hairline px-3 py-1.5 text-[12px] hover:bg-card-alt"
        >
          {t("print")}
        </Link>
      </div>
      <ReceiptSheet doc={doc} />
    </div>
  );
}
