import { sendEmail } from "@/lib/email";
import { emailText, escapeHtml } from "@/lib/email-i18n";

export async function sendClaimVerificationEmail(
  email: string,
  code: string,
  displayName: string,
  locale: string,
): Promise<void> {
  const t = await emailText(locale);
  await sendEmail({
    to: email,
    subject: t.text("claim.subject", { name: displayName }),
    html: t.layout(
      t.html("greeting"),
      t.html("claim.body", { name: displayName }),
      `<span dir="ltr" style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${escapeHtml(code)}</span>`,
      t.html("claim.expires"),
      t.html("ignore"),
    ),
  });
}
