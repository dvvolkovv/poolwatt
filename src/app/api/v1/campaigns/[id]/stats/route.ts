// GET /v1/campaigns/{id}/stats — §44 and its CSV export, US-44. The same
// numbers the dashboard shows: one row for the campaign, one per piece of
// content of its network.
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { domainError, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import {
  readCampaignAnalytics,
  readContentAnalytics,
} from "@/lib/marketing/campaign-analytics";

/** RFC 4180 enough for a spreadsheet: quote, double the quotes inside. */
function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, operatorId: true },
  });
  if (!campaign) return domainError(new Error("No such campaign"));

  try {
    const [campaigns, contents] = await Promise.all([
      readCampaignAnalytics(campaign.operatorId, user.id),
      readContentAnalytics(campaign.operatorId, user.id),
    ]);
    const row = campaigns.find((c) => c.campaignId === campaign.id);
    if (!row) return domainError(new Error("No such campaign"));

    const format = req.nextUrl.searchParams.get("format");
    if (format !== "csv") return ok({ campaign: row, content: contents });

    const lines: string[] = [];
    lines.push(
      [
        "kind",
        "name",
        "status",
        "clients",
        "new_clients",
        "returned",
        "returning_share",
        "issued_kwh",
        "used_kwh",
        "expired_kwh",
        "cost_per_client_kwh",
        "revenue_30_fiat",
        "revenue_30_kwh",
        "revenue_90_fiat",
        "revenue_90_kwh",
        "impressions",
        "clicks",
        "video_views",
        "ctr",
      ]
        .map(cell)
        .join(","),
    );
    lines.push(
      [
        "campaign",
        row.name,
        row.status,
        row.clients,
        row.newClients,
        row.returned,
        row.returningShare ?? "",
        row.issuedKwh,
        row.usedKwh,
        row.expiredKwh,
        row.costPerClientKwh ?? "",
        row.revenue30.fiat,
        row.revenue30.kwh,
        row.revenue90.fiat,
        row.revenue90.kwh,
        "",
        "",
        "",
        "",
      ]
        .map(cell)
        .join(","),
    );
    for (const c of contents) {
      lines.push(
        [
          "content",
          c.title,
          c.status,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          c.impressions,
          c.clicks,
          c.videoViews,
          c.ctr ?? "",
        ]
          .map(cell)
          .join(","),
      );
    }

    return new Response(`﻿${lines.join("\r\n")}\r\n`, {
      headers: {
        // BOM and CRLF: the same shape the accounting exports of §46 use, so
        // the partner's spreadsheet opens it without a word.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="campaign-${campaign.id}.csv"`,
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
