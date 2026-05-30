"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  changePasswordSchema,
  addEmailSchema,
  updatePhoneSchema,
} from "@/lib/validation";

export type FieldError = { fieldErrors?: Record<string, string>; formError?: string; ok?: boolean };

function tokenHex() {
  return randomBytes(32).toString("hex");
}

// ─── Email ────────────────────────────────────────────────────────────────

export async function addOrChangeEmailAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const raw = { email: String(formData.get("email") ?? "").trim().toLowerCase() };
  const parsed = addEmailSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: { email: parsed.error.issues[0].message } };
  }

  const sameEmailUser = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (sameEmailUser && sameEmailUser.id !== session.user.id) {
    return { fieldErrors: { email: "Этот email уже используется" } };
  }

  // Issue a verification token. We don't actually set user.email yet — it
  // lands once the token is consumed at /verify-email. This avoids a race
  // where someone "claims" another user's email + locks them out.
  const token = tokenHex();
  await prisma.emailVerificationToken.create({
    data: {
      token,
      userId: session.user.id,
      email: parsed.data.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),  // 1 h
    },
  });

  // Send the email if Resend is provisioned. Without RESEND_API_KEY we log
  // the link so devs can still test in staging; the user sees the same UX.
  try {
    const { sendVerificationEmail } = await import("@/lib/resend");
    await sendVerificationEmail(parsed.data.email, token);
  } catch (err) {
    console.error("[settings] verification-email send failed:", err);
  }

  return { ok: true };
}

// ─── Password ─────────────────────────────────────────────────────────────

export async function changePasswordAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const raw = {
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  };
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const f: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string") f[k] = issue.message;
    }
    return { fieldErrors: f };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user) return { formError: "Пользователь не найден" };

  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return { fieldErrors: { currentPassword: "Неверный текущий пароль" } };

  const newHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: newHash },
  });

  return { ok: true };
}

// ─── Preferences ──────────────────────────────────────────────────────────

const ALLOWED_LOCALES = new Set([
  "en", "ru", "de", "sk", "pl", "es", "it", "fr", "uk", "ja", "zh", "ar",
  "ro", "ka", "uz", "tg", "tk", "tr", "az", "kk", "ce", "he", "fa",
  "vi", "ko", "th", "hi", "ps", "ur",
]);
const ALLOWED_CURRENCIES = new Set(["USD", "EUR", "RUB", "GBP", "BRL"]);
const ALLOWED_THEMES = new Set(["light", "dark", "system"]);

export async function updatePreferencesAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const locale = String(formData.get("locale") ?? "");
  const currency = String(formData.get("currency") ?? "");
  const theme = String(formData.get("theme") ?? "");

  const data: Record<string, string> = {};
  if (ALLOWED_LOCALES.has(locale)) data.preferredLocale = locale;
  if (ALLOWED_CURRENCIES.has(currency)) data.preferredCurrency = currency;
  if (ALLOWED_THEMES.has(theme)) data.preferredTheme = theme;

  if (Object.keys(data).length === 0) return { formError: "Нечего сохранять" };

  await prisma.user.update({ where: { id: session.user.id }, data });
  revalidatePath("/[locale]/me/settings", "page");
  return { ok: true };
}

// ─── Phone ────────────────────────────────────────────────────────────────

export async function updatePhoneAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Not authenticated" };

  const raw = { phone: String(formData.get("phone") ?? "").trim() };
  const parsed = updatePhoneSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: { phone: parsed.error.issues[0].message } };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { phone: parsed.data.phone === "" ? null : parsed.data.phone },
  });
  revalidatePath("/[locale]/me/settings", "page");
  return { ok: true };
}

// ─── Delete account ───────────────────────────────────────────────────────

export async function deleteAccountAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirm !== session.user.username) {
    return { fieldErrors: { confirm: "Ник не совпадает" } };
  }

  // onDelete: Cascade everywhere on User relations handles favorites,
  // sessions, accounts, tokens. Nothing else to clean up.
  await prisma.user.delete({ where: { id: session.user.id } });
  await signOut({ redirect: false });

  return { ok: true };
}
