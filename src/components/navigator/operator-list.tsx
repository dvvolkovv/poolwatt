"use client";

// Раздел «Операторы»: кто обслуживает станции в этой области.
//
// Список строится из того, что сейчас найдено, а не из справочника: обещать
// оператора, у которого рядом нет ни одной станции, — врать водителю. Контакты
// и приложение берутся из справочника `OPERATOR_INFO`, если он того оператора
// знает. Нажатие оставляет в списке станций только его станции.

import { Globe, Phone, Smartphone, ChevronRight } from "lucide-react";
import { OPERATOR_INFO } from "@/lib/charger-operators";
import type { ChargerStation } from "@/lib/chargers";

export type OperatorRow = {
  name: string;
  stations: number;
  price: ChargerStation["operatorPrice"];
};

/** Операторы найденных станций, самые крупные первыми. */
export function operatorsOf(stations: ChargerStation[]): OperatorRow[] {
  const rows = new Map<string, OperatorRow>();
  for (const station of stations) {
    const name = station.operator?.trim();
    if (!name) continue;
    const row = rows.get(name) ?? { name, stations: 0, price: null };
    row.stations += 1;
    row.price = row.price ?? station.operatorPrice ?? null;
    rows.set(name, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.stations - a.stations || a.name.localeCompare(b.name),
  );
}

export function OperatorList({
  operators,
  onSelect,
  labels,
}: {
  operators: OperatorRow[];
  onSelect: (name: string) => void;
  labels: Record<string, string>;
}) {
  if (operators.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[14px] text-muted">
        {labels.noOperators}
      </p>
    );
  }

  return (
    <ul data-testid="operator-list" className="divide-y divide-hairline">
      {operators.map((operator) => {
        const info = OPERATOR_INFO[operator.name];
        return (
          <li key={operator.name} className="px-4 py-3">
            <button
              type="button"
              onClick={() => onSelect(operator.name)}
              data-testid="operator-row"
              className="flex w-full min-w-0 items-center gap-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {operator.name}
                </span>
                <span className="num mt-0.5 block text-[12px] text-muted">
                  {operator.stations} {labels.stationsFound}
                  {operator.price && (
                    <>
                      {" · "}
                      {Number(operator.price.pricePerKwh).toFixed(2)}{" "}
                      {operator.price.currency}/kWh
                    </>
                  )}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </button>

            {info && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <a
                  href={info.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <Globe size={11} />
                  {info.website.replace("https://", "").split("/")[0]}
                </a>
                <a
                  href={`tel:${info.phone}`}
                  className="inline-flex items-center gap-1 text-muted hover:text-foreground"
                >
                  <Phone size={11} />
                  {info.phone}
                </a>
                {info.app && (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <Smartphone size={11} />
                    {info.app}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
