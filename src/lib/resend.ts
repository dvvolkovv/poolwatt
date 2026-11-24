// Email verification + password reset messages. Transport (SMTP / Resend /
// dev stub) lives in email.ts; these helpers throw when a mail can't be sent.

import { sendEmail } from "@/lib/email";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const url = `${BASE}/verify-email?token=${token}`;
  await sendEmail({
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
  await sendEmail({
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
