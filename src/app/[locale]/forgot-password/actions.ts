"use server";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/resend";

export type ForgotState = {
  status?: "ok" | "no-email" | "unknown";
  formError?: string;
};

export async function forgotPasswordAction(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const raw = String(formData.get("identifier") ?? "").trim().toLowerCase();
  if (!raw) return { formError: "Введите ник или email" };
  const locale = String(formData.get("locale") ?? "");

  // Allow either nickname or email as the identifier — we look both up.
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: raw }, { email: raw }] },
    select: { id: true, email: true, emailVerified: true },
  });

  if (!user) {
    // Don't reveal whether the account exists (timing attack defense), but
    // since the user explicitly asks for recovery, telling them "we don't
    // recognize this" is more helpful than silence. Trade-off acknowledged.
    return { status: "unknown" };
  }

  if (!user.email || !user.emailVerified) {
    return { status: "no-email" };
  }

  const recent = await prisma.passwordResetToken.count({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= 3) {
    return { formError: "Письмо уже отправлено несколько раз. Проверьте почту или попробуйте через час." };
  }

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  try {
    await sendPasswordResetEmail(user.email, token, locale);
  } catch (err) {
    console.error("[forgot-password] send failed:", err);
    return { formError: "Не удалось отправить письмо. Попробуйте позже." };
  }

  return { status: "ok" };
}
