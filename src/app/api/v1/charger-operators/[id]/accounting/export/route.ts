// GET /api/v1/charger-operators/{id}/accounting/export — US-46, §46.
//
// The file an accountant downloads. Access is the §47 rule: the network's
// owner, the platform operator, or an employee with finance.read — and only
// the points that employee was given.

import type { NextRequest } from "next/server";
import { sessionUser, unauthorized } from "@/lib/exchange/api";
import { accountingAccess, readLedger } from "@/lib/accounting/ledger";
import { exportLedger } from "@/lib/accounting/export";
import {
  AccountingExportError,
  EXPORT_FORMATS,
  type ExportFormat,
} from "@/lib/accounting/formats";

function monthWindow(value: string | null): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

function isoWindow(from: string | null, to: string | null): { from: Date; to: Date } | null {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return null;
  return { from: a, to: b };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const url = new URL(req.url);

  const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    return Response.json(
      { error: `format must be one of ${EXPORT_FORMATS.join(", ")}` },
      { status: 400 },
    );
  }

  // Either ?month=YYYY-MM or an explicit half-open ?from=&to= window.
  const window =
    monthWindow(url.searchParams.get("month")) ??
    isoWindow(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!window) {
    return Response.json(
      { error: "pass month=YYYY-MM, or from and to as ISO dates" },
      { status: 400 },
    );
  }

  const access = await accountingAccess(id, user.id, user.role === "ADMIN");
  if (!access.allowed) return Response.json({ error: "Not found" }, { status: 404 });

  const ledger = await readLedger({
    operatorId: id,
    from: window.from,
    to: window.to,
    pointIds: access.pointIds,
  });

  try {
    const file = await exportLedger(ledger, format);
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AccountingExportError) {
      // 409: the request is fine, the partner's settings are not.
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
