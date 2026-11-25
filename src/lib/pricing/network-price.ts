// §52 — one price per kWh across a whole network, and §54's rule that
// changing it leaves a version behind.
//
// Three callers set this number: the cabinet form, `POST
// /charger-operators/{id}/price` from the operator's own system, and
// `PUT /v1/partners/{id}/pricing`. They all come through here, so none of
// them can change a price without recording it.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";
import { PricingError, recordPricingChange } from "./pricing-service";

export interface NetworkPriceChange {
  operatorId: string;
  /** Null clears the price: the navigator falls back to what it knew before. */
  pricePerKwh: number | null;
  currency: string | null;
  /** The person, when a person did it; null for the operator's own system. */
  actorId?: string | null;
  /** Skipped when the caller is an API key the network itself issued. */
  skipOwnerCheck?: boolean;
  note?: string | null;
}

export interface NetworkPriceView {
  pricePerKwh: number | null;
  currency: string | null;
  priceUpdatedAt: Date | null;
  version: number;
}

export async function setNetworkPrice(
  change: NetworkPriceChange,
  db: Db = prisma,
): Promise<NetworkPriceView> {
  if (change.pricePerKwh != null && !change.currency) {
    throw new PricingError("A price without a currency would render as a bare number");
  }
  if (change.pricePerKwh != null && !(change.pricePerKwh > 0)) {
    throw new PricingError("A price has to be more than zero");
  }

  const operator = await db.chargerOperator.findUnique({
    where: { id: change.operatorId },
    select: { id: true, claimedById: true },
  });
  if (!operator) throw new PricingError("No such network");
  if (!change.skipOwnerCheck && operator.claimedById !== change.actorId) {
    throw new PricingError("This network belongs to somebody else");
  }

  const now = new Date();
  const run = async (tx: Db) => {
    const updated = await tx.chargerOperator.update({
      where: { id: operator.id },
      data: {
        pricePerKwh:
          change.pricePerKwh == null ? null : new Prisma.Decimal(change.pricePerKwh),
        priceCurrency: change.pricePerKwh == null ? null : change.currency,
        priceUpdatedAt: change.pricePerKwh == null ? null : now,
      },
    });

    // §54 — the version and the live number in one transaction.
    const rule = await recordPricingChange(tx, {
      scope: "NETWORK_PRICE",
      scopeId: operator.id,
      operatorId: operator.id,
      params: { pricePerKwh: change.pricePerKwh, currency: change.currency ?? null },
      actorId: change.actorId ?? null,
      note: change.note ?? null,
    });

    return {
      pricePerKwh: change.pricePerKwh,
      currency: change.pricePerKwh == null ? null : change.currency,
      priceUpdatedAt: updated.priceUpdatedAt,
      version: rule.version,
    };
  };

  // A caller already inside a transaction keeps it; everybody else gets one.
  return "$transaction" in db ? db.$transaction((tx) => run(tx)) : run(db);
}
