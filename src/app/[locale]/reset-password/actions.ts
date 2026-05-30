"use server";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { resetPasswordSchema } from "@/lib/validation";

export type ResetState = {
  fieldErrors?: { newPassword?: string };
  formError?: string;
  ok?: boolean;
};

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const raw = {
    token: String(formData.get("token") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  };
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const f: ResetState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "newPassword") f.newPassword = issue.message;
    }
    return { fieldErrors: f };
  }

  const rec = await prisma.passwordResetToken.findUnique({
    where: { token: parsed.data.token },
  });
  if (!rec || rec.usedAt || rec.expiresAt.getTime() < Date.now()) {
    return { formError: "Ссылка устарела. Запросите новую." };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: rec.userId },
      data: { passwordHash: newHash },
    }),
    prisma.passwordResetToken.update({
      where: { token: parsed.data.token },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true };
}
