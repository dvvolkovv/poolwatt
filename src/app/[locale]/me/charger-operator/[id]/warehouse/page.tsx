// §49 "Склад запчастей" / US-50 — the keeper's page: what is on which shelf,
// what has fallen below its minimum, and the six operations of §49.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readStock } from "@/lib/warehouse/stock-service";
import {
  PartForm,
  RestockRequestRow,
  StockOperations,
  WarehouseForm,
} from "@/components/warehouse/stock-forms";

export const dynamic = "force-dynamic";

export default async function WarehousePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/warehouse`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("warehouse");

  const [stock, parts, staff] = await Promise.all([
    readStock(id, session.user.id),
    prisma.sparePart.findMany({
      where: { operatorId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true },
    }),
    prisma.employee.findMany({
      where: { operatorId: id },
      include: { user: { select: { username: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const employees = staff.map((e) => ({ id: e.id, name: e.user.name ?? e.user.username }));
  const kindNames = Object.fromEntries(
    ["CENTRAL", "REGIONAL", "VAN"].map((k) => [k, t(`kind.${k}`)]),
  );

  return (
    <div className="max-w-4xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-8 text-sm text-muted">{t("intro")}</p>

      {stock.openRequests.length > 0 && (
        <section className="mb-10" data-testid="restock-requests">
          <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
            {t("requests")}
          </h2>
          <ul className="divide-y divide-hairline text-sm">
            {stock.openRequests.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium text-down">
                    {r.partName} <span className="text-muted">({r.sku})</span>
                  </span>
                  <span className="text-[12px] text-muted">
                    {r.warehouseName} · {t("left")} <span className="num">{r.qtyAtRequest}</span> ·{" "}
                    {t("minimum")} <span className="num">{r.minQty}</span> · {t("order")}{" "}
                    <span className="num font-semibold">{r.suggestedQty}</span>
                    {r.notifiedAt == null && ` · ${t("notTold")}`}
                  </span>
                </div>
                <RestockRequestRow
                  requestId={r.id}
                  labels={{ ordered: t("markOrdered"), closed: t("markClosed") }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("levels")}</h2>
        {stock.items.length === 0 ? (
          <p className="text-sm text-muted" data-testid="stock-empty">
            {t("noStock")}
          </p>
        ) : (
          <table className="w-full text-[13px]" data-testid="stock-table">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2">{t("col.warehouse")}</th>
                <th className="py-2">{t("col.part")}</th>
                <th className="py-2 text-right">{t("col.qty")}</th>
                <th className="py-2 text-right">{t("col.min")}</th>
                <th className="py-2 text-right">{t("col.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {stock.items.map((i) => (
                <tr
                  key={`${i.warehouseId}-${i.partId}`}
                  className={`border-b border-hairline/50 ${i.below ? "text-down" : ""}`}
                >
                  <td className="py-2">
                    {i.warehouseName}{" "}
                    <span className="text-[11px] text-muted">{kindNames[i.warehouseKind]}</span>
                  </td>
                  <td className="py-2">
                    {i.partName} <span className="text-muted">({i.sku})</span>
                  </td>
                  <td className="num py-2 text-right font-semibold">{i.qty}</td>
                  <td className="num py-2 text-right">{i.minQty || "—"}</td>
                  <td className="num py-2 text-right">
                    {i.unitCostFiat == null ? "—" : `${i.unitCostFiat.toFixed(2)} ${i.currency}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {parts.length > 0 && stock.warehouses.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
            {t("operations")}
          </h2>
          <StockOperations
            parts={parts}
            warehouses={stock.warehouses.map((w) => ({ id: w.id, name: w.name }))}
            labels={{
              part: t("field.part"),
              warehouse: t("field.warehouse"),
              toWarehouse: t("field.toWarehouse"),
              qty: t("field.qty"),
              note: t("field.note"),
              receive: t("op.receive"),
              move: t("op.move"),
              writeOff: t("op.writeOff"),
              returnFaulty: t("op.returnFaulty"),
              stocktake: t("op.stocktake"),
              counted: t("field.counted"),
              minQty: t("field.minQty"),
              setMin: t("op.setMin"),
              serial: t("field.serial"),
              hint: t("operationsHint"),
            }}
          />
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("warehouses")}
        </h2>
        {stock.warehouses.length > 0 && (
          <ul className="mb-4 divide-y divide-hairline text-sm" data-testid="warehouse-list">
            {stock.warehouses.map((w) => (
              <li key={w.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span>{w.name}</span>
                <span className="text-[12px] text-muted">
                  {kindNames[w.kind]}
                  {w.city ? ` · ${w.city}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <WarehouseForm
          operatorId={id}
          employees={employees}
          labels={{
            name: t("field.warehouseName"),
            kind: t("field.kind"),
            city: t("field.city"),
            keeper: t("field.keeper"),
            nobody: t("nobody"),
            save: t("saveWarehouse"),
            kindNames,
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("parts")}</h2>
        {parts.length > 0 && (
          <ul className="mb-4 divide-y divide-hairline text-sm" data-testid="part-list">
            {parts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span>{p.name}</span>
                <span className="num text-[12px] text-muted">{p.sku}</span>
              </li>
            ))}
          </ul>
        )}
        <PartForm
          operatorId={id}
          labels={{
            sku: t("field.sku"),
            name: t("field.partName"),
            manufacturer: t("field.manufacturer"),
            models: t("field.models"),
            unitCost: t("field.unitCost"),
            currency: t("field.currency"),
            serialTracked: t("field.serialTracked"),
            save: t("savePart"),
            hint: t("partsHint"),
          }}
        />
      </section>
    </div>
  );
}
