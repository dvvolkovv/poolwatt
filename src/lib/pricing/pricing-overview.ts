// What a partner sees about their own tariffs — ТЗ §52 in one place, and §54's
// version next to every number.
//
// §52 is seven rows of a table, but in the code the numbers live in four
// different tables, each edited on its own page. This reads them all and pairs
// each with the version it is at, so a partner can answer "what am I charging,
// and since when" without opening four forms.

import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { currentPricing, readNetworkPricing, type PricingVersion } from "./pricing-service";

export interface VersionStamp {
  version: number | null;
  activeFrom: Date | null;
}

export interface NetworkPriceOverview extends VersionStamp {
  pricePerKwh: number | null;
  currency: string | null;
  updatedAt: Date | null;
}

export interface PointPricingOverview extends VersionStamp {
  pointId: string;
  pointName: string;
  status: string;
  tariffs: {
    label: string | null;
    fromMinute: number;
    toMinute: number;
    priceFiat: number | null;
    priceTokens: number | null;
    idleFeePerMin: number | null;
    coopDiscount: number;
    currency: string;
  }[];
  booking: (VersionStamp & {
    enabled: boolean;
    feeFiat: number;
    guaranteeFiat: number;
    noShowPenaltyFiat: number;
    freeCancelMinutes: number;
    coopFree: boolean;
  }) | null;
}

export interface PricingOverview {
  network: NetworkPriceOverview;
  points: PointPricingOverview[];
  history: PricingVersion[];
}

function stamp(rule: PricingVersion | null): VersionStamp {
  return { version: rule?.version ?? null, activeFrom: rule?.activeFrom ?? null };
}

export async function readPricingOverview(operatorId: string): Promise<PricingOverview> {
  const [operator, points, history] = await Promise.all([
    prisma.chargerOperator.findUniqueOrThrow({
      where: { id: operatorId },
      select: { pricePerKwh: true, priceCurrency: true, priceUpdatedAt: true },
    }),
    prisma.acceptancePoint.findMany({
      where: { operatorId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        tariffs: { orderBy: { fromMinute: "asc" } },
        policy: true,
      },
    }),
    readNetworkPricing(operatorId),
  ]);

  const networkRule = await currentPricing("NETWORK_PRICE", operatorId);

  // One pass over the history instead of a query per point: a network with
  // fifty points would otherwise mean a hundred round trips for one page.
  const latestByScope = new Map<string, PricingVersion>();
  for (const rule of history) {
    const key = `${rule.scope}:${rule.scopeId}`;
    if (!latestByScope.has(key)) latestByScope.set(key, rule);
  }

  return {
    network: {
      pricePerKwh: numOrNull(operator.pricePerKwh),
      currency: operator.priceCurrency,
      updatedAt: operator.priceUpdatedAt,
      ...stamp(networkRule),
    },
    points: points.map((p) => ({
      pointId: p.id,
      pointName: p.name,
      status: p.status,
      tariffs: p.tariffs.map((t) => ({
        label: t.label,
        fromMinute: t.fromMinute,
        toMinute: t.toMinute,
        priceFiat: numOrNull(t.priceFiat),
        priceTokens: numOrNull(t.priceTokens),
        idleFeePerMin: numOrNull(t.idleFeePerMin),
        coopDiscount: t.coopDiscount,
        currency: t.currency,
      })),
      booking: p.policy
        ? {
            enabled: p.policy.enabled,
            feeFiat: num(p.policy.feeFiat),
            guaranteeFiat: num(p.policy.guaranteeFiat),
            noShowPenaltyFiat: num(p.policy.noShowPenaltyFiat),
            freeCancelMinutes: p.policy.freeCancelMinutes,
            coopFree: p.policy.coopFree,
            ...stamp(latestByScope.get(`RESERVATION_POLICY:${p.id}`) ?? null),
          }
        : null,
      ...stamp(latestByScope.get(`POINT_TARIFF:${p.id}`) ?? null),
    })),
    history,
  };
}
