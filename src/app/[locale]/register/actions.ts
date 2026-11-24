"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { registerSchema } from "@/lib/validation";
import { signIn } from "@/lib/auth";
import { toLocale } from "@/lib/email-i18n";
import { issueEmailVerification, verificationLimitReached } from "@/lib/email-verification";

export type RegisterFormState = {
  ok?: boolean;
  fieldErrors?: { username?: string; email?: string; password?: string };
  formError?: string;
};

export async function registerAction(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const raw = {
    username: String(formData.get("username") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const f: RegisterFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "username" || key === "email" || key === "password") f[key] = issue.message;
    }
    return { fieldErrors: f };
  }
  const { username, email, password } = parsed.data;
  const locale = toLocale(String(formData.get("locale") ?? ""));

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return { fieldErrors: { username: "Этот ник уже занят" } };
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return { fieldErrors: { email: "Этот email уже используется" } };
  }
  if (await verificationLimitReached(email)) {
    return { fieldErrors: { email: "На этот email уже отправлено несколько писем. Попробуйте через час." } };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username, passwordHash, role: "USER", preferredLocale: locale },
    select: { id: true },
  });
  // A failed mail must not block the account: the cabinet asks again.
  await issueEmailVerification(user.id, email, locale);

  // Sign the user in immediately so the next page sees a valid session.
  // signIn() throws a NEXT_REDIRECT, which Next's redirect chain will surface
  // to the form.
  await signIn("credentials", {
    username,
    password,
    redirectTo: `/${locale}/me?welcome=1`,
  });
  // signIn() handles the redirect itself; this line is unreachable but
  // satisfies TypeScript's return-type narrowing.
  redirect(`/${locale}/me?welcome=1`);
}
