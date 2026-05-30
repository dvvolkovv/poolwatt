// Resend integration for email verification + password reset. Lives in a
// dedicated module so the rest of the app doesn't import the SDK; missing
// RESEND_API_KEY is handled here, not at every call-site. When the env var
// is empty the helpers log to console and resolve successfully — useful for
// local development without a real key.

import { Resend } from "resend";

const FROM = "Poolwatt <noreply@poolwatt.com>";
const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

let cachedClient: Resend | null = null;
function client(): Resend | null {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const url = `${BASE}/verify-email?token=${token}`;
  const c = client();
  if (!c) {
    console.log(`[resend stub] would send verification to ${email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: email,
    subject: "Подтвердите email для Poolwatt",
    html: `
      <p>Здравствуйте,</p>
      <p>Кто-то добавил этот email к аккаунту в Poolwatt. Если это были вы, нажмите на ссылку ниже, чтобы подтвердить — она действует 1 час:</p>
      <p><a href="${url}">${url}</a></p>
      <p>Если это были не вы — просто проигнорируйте письмо.</p>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const url = `${BASE}/reset-password?token=${token}`;
  const c = client();
  if (!c) {
    console.log(`[resend stub] would send password reset to ${email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: email,
    subject: "Сброс пароля Poolwatt",
    html: `
      <p>Здравствуйте,</p>
      <p>Кто-то запросил сброс пароля для аккаунта в Poolwatt с этим email. Если это были вы, нажмите на ссылку ниже, чтобы задать новый пароль — она действует 1 час:</p>
      <p><a href="${url}">${url}</a></p>
      <p>Если это были не вы — просто проигнорируйте письмо.</p>
    `,
  });
}
