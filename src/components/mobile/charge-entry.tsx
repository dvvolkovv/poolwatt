"use client";

// Вкладка «Зарядка», когда сеанса нет: QR, код руками и что рядом.

import { useRouter } from "next/navigation";
import { QrScan, type QrScanLabels } from "./qr-scan";
import { NearbyPoints } from "./nearby-points";
import type { ConnectorCode } from "@/lib/exchange/qr-code";

export function ChargeEntry({
  locale,
  labels,
}: {
  locale: string;
  labels: QrScanLabels & { nearby: string; nearbyHelp: string; nearbyEmpty: string };
}) {
  const router = useRouter();

  function open(code: ConnectorCode) {
    const query = new URLSearchParams({ p: code.pointId });
    if (code.connectorId) query.set("c", code.connectorId);
    router.push(`/${locale}/app/charge/start?${query}`);
  }

  return (
    <div>
      <QrScan labels={labels} onCode={open} />
      <NearbyPoints
        locale={locale}
        labels={{
          nearby: labels.nearby,
          nearbyHelp: labels.nearbyHelp,
          nearbyEmpty: labels.nearbyEmpty,
        }}
      />
    </div>
  );
}
