import { Resend } from "resend";

const FROM = "Poolwatt <noreply@poolwatt.com>";

let cachedClient: Resend | null = null;
function client(): Resend | null {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendClaimVerificationEmail(
  email: string,
  code: string,
  displayName: string,
): Promise<void> {
  const c = client();
  if (!c) {
    console.log(`[resend stub] would send claim code to ${email}: ${code} (for ${displayName})`);
    return;
  }
  await c.emails.send({
    from: FROM,
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
