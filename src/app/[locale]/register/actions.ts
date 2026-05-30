"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { registerSchema } from "@/lib/validation";
import { signIn } from "@/lib/auth";

export type RegisterFormState = {
  ok?: boolean;
  fieldErrors?: { username?: string; password?: string };
  formError?: string;
};

export async function registerAction(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const raw = {
    username: String(formData.get("username") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const f: RegisterFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "username" || key === "password") f[key] = issue.message;
    }
    return { fieldErrors: f };
  }
  const { username, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return { fieldErrors: { username: "Этот ник уже занят" } };
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { username, passwordHash, role: "USER" },
  });

  // Sign the user in immediately so the next page sees a valid session.
  // signIn() throws a NEXT_REDIRECT, which Next's redirect chain will surface
  // to the form. The redirect target carries ?welcome=1 so the cabinet shows
  // the "add email" banner exactly once.
  const locale = String(formData.get("locale") ?? "en");
  await signIn("credentials", {
    username,
    password,
    redirectTo: `/${locale}/me?welcome=1`,
  });
  // signIn() handles the redirect itself; this line is unreachable but
  // satisfies TypeScript's return-type narrowing.
  redirect(`/${locale}/me?welcome=1`);
}
