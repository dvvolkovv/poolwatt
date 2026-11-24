// Reconciliation alerts — ТЗ §16.11. A nightly check nobody is told about is
// a nightly check nobody acts on.
//
// Mail must never fail the run: it logs and returns on error, like the other
// senders here.

import { sendEmail } from "@/lib/email";
import { operatorEmail } from "@/lib/operator-email";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export interface DriftSummary {
  runId: string;
  driftCount: number;
  windowFrom: string;
  windowTo: string;
  checks: { name: string; checked: number; drifts: { subject: string; expectedKwh: number; actualKwh: number; note?: string }[] }[];
}

export async function sendReconciliationDrift(summary: DriftSummary): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[resend-reconciliation] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping alert");
    return;
  }

  const rows = summary.checks
    .filter((c) => c.drifts.length > 0)
    .map((c) => {
      const items = c.drifts
        .slice(0, 20)
        .map(
          (d) =>
            `<li><code>${d.subject}</code>: expected <b>${d.expectedKwh}</b> kWh, ` +
            `found <b>${d.actualKwh}</b> kWh${d.note ? ` — ${d.note}` : ""}</li>`,
        )
        .join("");
      const more = c.drifts.length > 20 ? `<p>…and ${c.drifts.length - 20} more.</p>` : "";
      return `<h3>${c.name} — ${c.drifts.length} of ${c.checked} checked</h3><ul>${items}</ul>${more}`;
    })
    .join("");

  try {
    await sendEmail({
      to,
      subject: `[Poolwatt] Token registry reconciliation found ${summary.driftCount} drift(s)`,
      html: `
        <p>The nightly reconciliation of the token registry (ТЗ §16.11) found
           <b>${summary.driftCount}</b> disagreement(s) in the window
           ${summary.windowFrom} — ${summary.windowTo}.</p>
        <p>Nothing was repaired automatically: each drift is a bug upstream.</p>
        ${rows}
        <p><a href="${BASE}/en/admin/reconciliation">Open the reconciliation log</a></p>
      `,
    });
  } catch (err) {
    console.error("[resend-reconciliation] alert failed", err);
  }
}
