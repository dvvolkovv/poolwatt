// Single outbound-mail transport; every resend-*.ts helper goes through here.
// Our own mail server over SMTP, with Resend's HTTPS API as an override when
// RESEND_API_KEY is set.
//
// Default port is 2525, not 587: the production host's provider drops
// outbound 25/465/587 to every destination.

import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

export type OutgoingEmail = { to: string; subject: string; html: string };

let transporter: Transporter | null = null;
function smtp(): Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 2525);
  const secure = port === 465;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    // Nodemailer waits 2 minutes by default — too long for a form submit.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

let resendClient: Resend | null = null;
function resend(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail({ to, subject, html }: OutgoingEmail): Promise<void> {
  // The test suite runs against the real environment of this box, keys
  // included, so without this switch every service that notifies somebody
  // posted real mail to invented addresses like `test_x@test.local` — slow,
  // and bouncing in the owner's own inbox. `MAIL_STUB` is set for the whole
  // vitest run (see `vitest.config.ts`); the tests of this file turn it off
  // to exercise the transports themselves.
  if (process.env.MAIL_STUB === "1") {
    console.log(`[mail stub] to ${to}: ${subject}`);
    return;
  }

  const from = process.env.EMAIL_FROM || "Poolwatt <noreply@poolwatt.com>";
  const replyTo = process.env.EMAIL_REPLY_TO || "info@poolwatt.com";
  const text = htmlToText(html);
  const headers = {
    "List-Unsubscribe": "<mailto:noreply@poolwatt.com?subject=unsubscribe>",
    "Auto-Submitted": "auto-generated",
  };

  const r = resend();
  if (r) {
    // The SDK resolves with { error } rather than throwing.
    const { error } = await r.emails.send({ from, to: [to], replyTo, subject, html, text, headers });
    if (error) throw new Error(`[mail] Resend: ${error.name}: ${error.message}`);
    return;
  }

  const t = smtp();
  if (t) {
    await t.sendMail({ from, to, replyTo, subject, html, text, headers });
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("[mail] not configured: set SMTP_HOST, SMTP_USER and SMTP_PASS");
  }
  console.log(`[mail stub] to ${to}: ${subject}\n${text}`);
}
