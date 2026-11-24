import { sendEmail } from "@/lib/email";

export async function sendClaimVerificationEmail(
  email: string,
  code: string,
  displayName: string,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Poolwatt — verification code for ${displayName}`,
    html: `
      <p>Hello,</p>
      <p>Someone requested to claim the <strong>${displayName}</strong> profile on Poolwatt with this email.</p>
      <p>Your verification code is:</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>The code is valid for 30 minutes. If you didn't request this, just ignore this email.</p>
    `,
  });
}
