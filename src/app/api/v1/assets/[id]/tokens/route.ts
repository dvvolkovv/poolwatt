// GET /v1/assets/{id}/tokens?from=&to=&format=csv — ТЗ §15, US-05.
import type { NextRequest } from "next/server";
import { domainError, forbidden, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readAssetTokens } from "@/lib/exchange/telemetry-service";
import { prisma } from "@/lib/prisma";

const DEFAULT_WINDOW_DAYS = 7;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { company: { select: { ownerUserId: true } } },
  });
  if (!asset) return domainError(new Error("Asset not found"));
  if (asset.company.ownerUserId !== user.id && user.role !== "ADMIN") return forbidden();

  const url = new URL(req.url);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
  const from = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return domainError(new Error("Invalid from/to date"));
  }

  const summary = await readAssetTokens({ assetId: id, from, to });

  // US-05 "экспорт CSV".
  if (url.searchParams.get("format") === "csv") {
    const header = "batch_id,interval_start,amount_kwh,status,go_certificate_ref";
    const rows = summary.batches.map((b) =>
      [b.id, b.intervalStart, b.amountKwh, b.status, b.goCertificateRef ?? ""].join(","),
    );
    return new Response([header, ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tokens-${id}.csv"`,
      },
    });
  }

  return ok({ summary });
}
