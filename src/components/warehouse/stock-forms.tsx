"use client";

// §49's forms: a part, a store, and the six operations on a level.

import { useState, useTransition } from "react";
import {
  closeRequestAction,
  moveAction,
  receiveAction,
  returnFaultyAction,
  savePartAction,
  saveWarehouseAction,
  setMinQtyAction,
  stocktakeAction,
  writeOffAction,
} from "@/app/[locale]/me/charger-operator/[id]/warehouse/actions";

const field = "rounded border border-hairline bg-bg px-2 py-1 text-sm";
const label = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; formError?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.formError ?? "Could not do that.");
      else after?.();
    });
  return { error, pending, run };
}

export function PartForm({
  operatorId,
  labels,
}: {
  operatorId: string;
  labels: {
    sku: string;
    name: string;
    manufacturer: string;
    models: string;
    unitCost: string;
    currency: string;
    serialTracked: string;
    save: string;
    hint: string;
  };
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [models, setModels] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [serialTracked, setSerialTracked] = useState(false);
  const { error, pending, run } = useAction();

  return (
    <form
      className="space-y-3"
      data-testid="part-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            savePartAction({
              operatorId,
              sku,
              name,
              manufacturer: manufacturer.trim() || null,
              compatibleModels: models
                .split(",")
                .map((m) => m.trim())
                .filter(Boolean),
              unitCostFiat: unitCost.trim() === "" ? null : Number(unitCost),
              currency,
              serialTracked,
            }),
          () => {
            setSku("");
            setName("");
            setModels("");
          },
        );
      }}
    >
      <p className="text-[12px] text-muted">{labels.hint}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.sku}</span>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            aria-label={labels.sku}
            className={`${field} w-32`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.name}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={labels.name}
            className={`${field} w-[220px]`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.manufacturer}</span>
          <input
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            aria-label={labels.manufacturer}
            className={`${field} w-32`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.models}</span>
          <input
            value={models}
            onChange={(e) => setModels(e.target.value)}
            aria-label={labels.models}
            className={`${field} w-[200px]`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.unitCost}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            aria-label={labels.unitCost}
            className={`num ${field} w-24`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.currency}</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            aria-label={labels.currency}
            className={`${field} w-16`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={serialTracked}
            onChange={(e) => setSerialTracked(e.target.checked)}
          />
          {labels.serialTracked}
        </label>
        <button
          type="submit"
          disabled={pending || sku.trim() === "" || name.trim().length < 2}
          data-testid="save-part"
          className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.save}
        </button>
      </div>
      {error && (
        <p className="text-[13px] text-down" data-testid="part-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function WarehouseForm({
  operatorId,
  employees,
  labels,
}: {
  operatorId: string;
  employees: { id: string; name: string }[];
  labels: {
    name: string;
    kind: string;
    city: string;
    keeper: string;
    nobody: string;
    save: string;
    kindNames: Record<string, string>;
  };
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("REGIONAL");
  const [city, setCity] = useState("");
  const [keeperEmployeeId, setKeeperEmployeeId] = useState("");
  const { error, pending, run } = useAction();

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      data-testid="warehouse-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveWarehouseAction({
              operatorId,
              name,
              kind,
              city: city.trim() || null,
              keeperEmployeeId: keeperEmployeeId || null,
            }),
          () => {
            setName("");
            setCity("");
          },
        );
      }}
    >
      <label className="block text-sm">
        <span className={label}>{labels.name}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={labels.name}
          className={`${field} w-40`}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.kind}</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label={labels.kind}
          className={field}
        >
          {["CENTRAL", "REGIONAL", "VAN"].map((k) => (
            <option key={k} value={k}>
              {labels.kindNames[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.city}</span>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label={labels.city}
          className={`${field} w-32`}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.keeper}</span>
        <select
          value={keeperEmployeeId}
          onChange={(e) => setKeeperEmployeeId(e.target.value)}
          aria-label={labels.keeper}
          className={field}
        >
          <option value="">{labels.nobody}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending || name.trim().length < 2}
        data-testid="save-warehouse"
        className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {labels.save}
      </button>
      {error && (
        <p className="w-full text-[13px] text-down" data-testid="warehouse-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function StockOperations({
  parts,
  warehouses,
  labels,
}: {
  parts: { id: string; name: string; sku: string }[];
  warehouses: { id: string; name: string }[];
  labels: {
    part: string;
    warehouse: string;
    toWarehouse: string;
    qty: string;
    note: string;
    receive: string;
    move: string;
    writeOff: string;
    returnFaulty: string;
    stocktake: string;
    counted: string;
    minQty: string;
    setMin: string;
    serial: string;
    hint: string;
  };
}) {
  const [partId, setPartId] = useState(parts[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState(warehouses[1]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [counted, setCounted] = useState("0");
  const [minQty, setMinQty] = useState("0");
  const [serialNo, setSerialNo] = useState("");
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();

  const base = { partId, warehouseId, qty: Number(qty), note: note.trim() || null };
  const ready = partId !== "" && warehouseId !== "";

  const button = (text: string, testId: string, fn: () => Promise<{ ok: boolean; formError?: string }>, enabled = true) => (
    <button
      type="button"
      disabled={pending || !ready || !enabled}
      data-testid={testId}
      onClick={() => run(fn)}
      className="rounded border border-hairline px-3 py-1 text-[13px] hover:border-accent disabled:opacity-50"
    >
      {text}
    </button>
  );

  return (
    <div className="space-y-3" data-testid="stock-operations">
      <p className="text-[12px] text-muted">{labels.hint}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.part}</span>
          <select
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            aria-label={labels.part}
            className={field}
          >
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.warehouse}</span>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            aria-label={labels.warehouse}
            className={field}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.qty}</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label={labels.qty}
            className={`num ${field} w-20`}
          />
        </label>
        <label className="block grow text-sm">
          <span className={label}>{labels.note}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={labels.note}
            className={`${field} w-full`}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {button(labels.receive, "op-receive", () => receiveAction(base))}
        {button(labels.writeOff, "op-write-off", () => writeOffAction(base), note.trim() !== "")}
        {button(labels.returnFaulty, "op-return", () =>
          returnFaultyAction({ ...base, serialNo: serialNo.trim() || null }),
        )}
        <label className="block text-sm">
          <span className={label}>{labels.serial}</span>
          <input
            value={serialNo}
            onChange={(e) => setSerialNo(e.target.value)}
            aria-label={labels.serial}
            className={`${field} w-32`}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.toWarehouse}</span>
          <select
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            aria-label={labels.toWarehouse}
            className={field}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {button(
          labels.move,
          "op-move",
          () =>
            moveAction({
              partId,
              fromWarehouseId: warehouseId,
              toWarehouseId,
              qty: Number(qty),
              note: note.trim() || null,
            }),
          toWarehouseId !== "" && toWarehouseId !== warehouseId,
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.counted}</span>
          <input
            type="number"
            min={0}
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            aria-label={labels.counted}
            className={`num ${field} w-20`}
          />
        </label>
        {button(labels.stocktake, "op-stocktake", () =>
          stocktakeAction({
            partId,
            warehouseId,
            countedQty: Number(counted),
            note: note.trim() || null,
          }),
        )}
        <label className="block text-sm">
          <span className={label}>{labels.minQty}</span>
          <input
            type="number"
            min={0}
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
            aria-label={labels.minQty}
            className={`num ${field} w-20`}
          />
        </label>
        {button(labels.setMin, "op-set-min", () =>
          setMinQtyAction({ partId, warehouseId, minQty: Number(minQty) }),
        )}
      </div>

      {error && (
        <p className="text-[13px] text-down" data-testid="stock-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function RestockRequestRow({
  requestId,
  labels,
}: {
  requestId: string;
  labels: { ordered: string; closed: string };
}) {
  const { error, pending, run } = useAction();

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        data-testid={`ordered-${requestId}`}
        onClick={() => run(() => closeRequestAction({ requestId, status: "ORDERED", note: null }))}
        className="rounded border border-hairline px-2 py-0.5 text-[12px] hover:border-accent disabled:opacity-50"
      >
        {labels.ordered}
      </button>
      <button
        type="button"
        disabled={pending}
        data-testid={`closed-${requestId}`}
        onClick={() => run(() => closeRequestAction({ requestId, status: "CLOSED", note: null }))}
        className="rounded border border-hairline px-2 py-0.5 text-[12px] text-muted hover:border-accent disabled:opacity-50"
      >
        {labels.closed}
      </button>
      {error && <span className="text-[12px] text-down">{error}</span>}
    </span>
  );
}
