// The receipt a buyer opens from the wallet history — ТЗ §46, US-07, US-45.
// A receipt that is not yours does not exist here.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";
import { readReceiptDocument } from "@/lib/receipts/receipt-store";
import { ReceiptSheet } from "@/components/receipts/receipt-sheet";
import { readLiveContent } from "@/lib/marketing/content-service";
import { ContentSection } from "@/components/marketing/content-block";
import { CorrectionBanner } from "@/components/receipts/correction-banner";
import { readCorrectionJournal } from "@/lib/receipts/receipt-correction";
import { prisma } from "@/lib/prisma";

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

  const doc = await readReceiptDocument(id);
  if (!doc) notFound();

  const t = await getTranslations("receipt");
  const tMarketing = await getTranslations("marketing");

  // §46 — which version this is, and what was changed to get here.
  const chain = await prisma.receipt.findUniqueOrThrow({
    where: { id },
    select: {
      corrects: { select: { id: true, number: true } },
      correctedBy: { select: { id: true, number: true } },
    },
  });
  const journal = await readCorrectionJournal(id);

  // §41 "экран завершения зарядки" — this page is what a driver sees once the
  // session is paid for, so it is where that placement lives. A trade receipt
  // has no point and therefore no network to advertise.
  const marketing = doc.session?.pointId
    ? await readLiveContent(doc.session.pointId, "CHARGE_COMPLETE", session.user.id)
    : [];

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
      <CorrectionBanner
        locale={locale}
        correctedBy={chain.correctedBy}
        corrects={chain.corrects}
        journal={journal}
        labels={{
          correctedBy: t("correctedBy", { number: "{number}" }),
          correctsDocument: t("correctsDocument", { number: "{number}" }),
          journal: t("journal"),
        }}
      />
      <ReceiptSheet doc={doc} />

      <div className="mt-10" data-print-hide>
        <ContentSection contents={marketing} heading={tMarketing("sectionHeading")} />
      </div>
    </div>
  );
}
