// GET /v1/points/resolve?code= — что зашито в QR на разъёме (US-20).
import { NextRequest, NextResponse } from "next/server";
import { ConnectorStatus, PointStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseConnectorCode } from "@/lib/exchange/qr-code";
import { num, numOrNull } from "@/lib/exchange/decimal";

export async function GET(req: NextRequest) {
  const parsed = parseConnectorCode(req.nextUrl.searchParams.get("code"));
  if (!parsed) {
    return NextResponse.json({ error: "This is not a Poolwatt code" }, { status: 422 });
  }

  const point = await prisma.acceptancePoint.findFirst({
    where: { id: parsed.pointId, status: PointStatus.PUBLISHED },
    select: {
      id: true,
      name: true,
      addressLine: true,
      city: true,
      gridZoneId: true,
      connectors: {
        select: { id: true, type: true, powerKw: true, status: true },
        orderBy: { powerKw: "desc" },
      },
      tariffs: { orderBy: { fromMinute: "asc" }, take: 1 },
    },
  });
  if (!point) return NextResponse.json({ error: "No such point" }, { status: 404 });

  const connectors = point.connectors.map((c) => ({
    id: c.id,
    type: String(c.type),
    powerKw: num(c.powerKw),
    status: c.status,
  }));
  // Наклейка на пункте без номера разъёма — берём первый свободный: водитель
  // стоит у станции, а не выбирает из списка.
  const chosen = parsed.connectorId
    ? (connectors.find((c) => c.id === parsed.connectorId) ?? null)
    : (connectors.find((c) => c.status === ConnectorStatus.FREE) ?? null);

  return NextResponse.json({
    point: {
      id: point.id,
      name: point.name,
      address: [point.addressLine, point.city].filter(Boolean).join(", "),
      zoneId: point.gridZoneId,
      priceFiat: numOrNull(point.tariffs[0]?.priceFiat ?? null),
      currency: point.tariffs[0]?.currency ?? "EUR",
    },
    connectors,
    connectorId: chosen?.id ?? null,
  });
}
