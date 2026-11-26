// §22.8 «Контакты и переводы» — экран перевода кВт·ч (US-19).
//
// Переключатель §24.4 закрыт, пока нет заключения литовского юриста. Закрыто
// означает: формы перевода нет, а всё остальное работает — мой QR на
// получение, пределы AML, входящие переводы. Делать вид, что функция есть,
// нельзя; прятать весь экран — тоже незачем.

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { transfersOpen } from "@/lib/exchange/gates";
import { transferAllowance } from "@/lib/exchange/transfer-service";
import { hasDeviceKey } from "@/lib/webauthn/device-keys";
import { Screen } from "@/components/mobile/screen";
import { ReceiveQr } from "@/components/mobile/receive-qr";
import { TransferForm } from "@/components/mobile/transfer-form";
import { IncomingTransfers } from "@/components/mobile/incoming-transfers";
import { acceptTransfer, declineTransfer, sendTransfer } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactsScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/contacts`);
  }

  const t = await getTranslations("app.transfer");
  const tCharge = await getTranslations("app.charge");

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { username: true },
  });

  // Зона берётся из кошелька: §24 держит перевод внутри одной зоны, и зона
  // человека — та, в которой у него есть кВт·ч.
  const wallet = await prisma.wallet.findFirst({
    where: { ownerUserId: session.user.id },
    orderBy: { kwhBalance: "desc" },
    select: { zoneId: true },
  });

  const [allowance, incomingRows, device] = await Promise.all([
    wallet ? transferAllowance(session.user.id, wallet.zoneId) : Promise.resolve(null),
    prisma.tokenTransfer.findMany({
      where: { toWallet: { ownerUserId: session.user.id }, status: "CREATED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        fromWallet: { select: { owner: { select: { username: true, name: true } } } },
      },
    }),
    hasDeviceKey(session.user.id),
  ]);

  const incoming = incomingRows.map((r) => ({
    id: r.id,
    from: r.fromWallet.owner?.name ?? r.fromWallet.owner?.username ?? "—",
    amountKwh: num(r.amountKwh),
    note: r.note,
    at: r.createdAt.toISOString(),
  }));

  const open = transfersOpen();

  return (
    <Screen title={t("title")} back={`/${locale}/app/more`}>
      <ReceiveQr
        username={me.username}
        labels={{ myQr: t("myQr"), myQrHint: t("myQrHint") }}
      />

      {allowance ? (
        <section className="mt-6" data-testid="transfer-allowance">
          <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
            {t("allowance")}
          </h2>
          <div className="mt-2 flex gap-6 rounded-lg border border-hairline bg-card px-3 py-3">
            <div>
              <div className="num text-[20px]">
                {(allowance.dailyLimitKwh - allowance.dailyUsedKwh).toFixed(3)}
              </div>
              <div className="text-[12px] text-muted">{t("allowanceToday")}</div>
            </div>
            <div>
              <div className="num text-[20px]">
                {(allowance.monthlyLimitKwh - allowance.monthlyUsedKwh).toFixed(3)}
              </div>
              <div className="text-[12px] text-muted">{t("allowanceMonth")}</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">{t("allowanceHint")}</p>
        </section>
      ) : (
        <p className="mt-6 text-[13px] text-muted" data-testid="transfer-no-zone">
          {t("needZone")}
        </p>
      )}

      <IncomingTransfers
        rows={incoming}
        labels={{
          incoming: t("incoming"),
          accept: t("accept"),
          decline: t("decline"),
          noIncoming: t("noIncoming"),
        }}
        accept={acceptTransfer}
        decline={declineTransfer}
      />

      {open && wallet ? (
        <TransferForm
          zoneId={wallet.zoneId}
          hasDevice={device}
          labels={{
            recipient: t("recipient"),
            recipientHint: t("recipientHint"),
            amount: t("amount"),
            note: t("note"),
            requireConfirmation: t("requireConfirmation"),
            send: t("send"),
            sending: t("sending"),
            sent: t("sent"),
            confirmWithDevice: t("confirmWithDevice"),
            // Сканер общий с экраном зарядки, подписи у него оттуда же.
            scan: t("scan"),
            scanning: t("scanning"),
            manual: t("recipient"),
            manualHint: t("recipientHint"),
            submit: tCharge("submit"),
            denied: t("denied"),
            notOurs: t("notOurs"),
          }}
          submit={sendTransfer}
        />
      ) : (
        <p
          className="mt-6 rounded-lg border border-hairline bg-card px-3 py-3 text-[13px] leading-snug text-muted"
          data-testid="transfer-closed"
        >
          {t("closed")}
        </p>
      )}

      <p className="mt-4 text-[11px] leading-snug text-muted">{t("coopOnly")}</p>
    </Screen>
  );
}
