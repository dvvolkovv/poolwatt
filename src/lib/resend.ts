// Email verification + password reset messages. Transport (SMTP / Resend /
// dev stub) lives in email.ts; these helpers throw when a mail can't be sent.

import { sendEmail } from "@/lib/email";
import { emailLink, emailText } from "@/lib/email-i18n";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export async function sendVerificationEmail(email: string, token: string, locale: string): Promise<void> {
  const t = await emailText(locale);
  const url = `${BASE}/${t.locale}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: t.text("verify.subject"),
    html: t.layout(t.html("greeting"), t.html("verify.body"), ...emailLink(url, t.html("verify.cta")), t.html("ignore")),
  });
}

export async function sendPasswordResetEmail(email: string, token: string, locale: string): Promise<void> {
  const t = await emailText(locale);
  const url = `${BASE}/${t.locale}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: t.text("reset.subject"),
    html: t.layout(t.html("greeting"), t.html("reset.body"), ...emailLink(url, t.html("reset.cta")), t.html("ignore")),
  });
}
