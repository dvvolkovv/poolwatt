"use server";

import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { toLocale } from "@/lib/email-i18n";
import { issueEmailVerification, verificationLimitReached } from "@/lib/email-verification";
import {
  changePasswordSchema,
  setPasswordSchema,
  addEmailSchema,
  updatePhoneSchema,
  updateNameSchema,
} from "@/lib/validation";
import { TALERID_PROVIDER_ID } from "@/lib/talerid/config";

export type FieldError = { fieldErrors?: Record<string, string>; formError?: string; ok?: boolean };

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

  if (await verificationLimitReached(parsed.data.email)) {
    return { formError: "На этот email уже отправлено несколько писем. Попробуйте через час." };
  }

  const locale = toLocale(String(formData.get("locale") ?? ""));
  // "en" is the column default, so treat it as "not chosen yet".
  await prisma.user.updateMany({
    where: { id: session.user.id, preferredLocale: "en" },
    data: { preferredLocale: locale },
  });
  if (!(await issueEmailVerification(session.user.id, parsed.data.email, locale))) {
    return { formError: "Не удалось отправить письмо. Попробуйте позже." };
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
  if (!user.passwordHash) return { formError: "Пароль ещё не задан" };

  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return { fieldErrors: { currentPassword: "Неверный текущий пароль" } };

  const newHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: newHash },
  });

  return { ok: true };
}

// Accounts created through Taler ID start without a password. There is no
// current password to ask for, so the update is conditional on the hash still
// being null: this can never overwrite an existing password.
export async function setPasswordAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const parsed = setPasswordSchema.safeParse({
    newPassword: String(formData.get("newPassword") ?? ""),
  });
  if (!parsed.success) {
    return { fieldErrors: { newPassword: parsed.error.issues[0].message } };
  }

  const { count } = await prisma.user.updateMany({
    where: { id: session.user.id, passwordHash: null },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });
  if (count === 0) return { formError: "Пароль уже задан" };

  revalidatePath("/[locale]/me/settings", "page");
  return { ok: true };
}

// ─── Taler ID ─────────────────────────────────────────────────────────────

export async function unlinkTalerIdAction(): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  // Without a password the link is the only way in. One statement, so the
  // check and the delete cannot drift apart.
  const { count } = await prisma.account.deleteMany({
    where: {
      userId: session.user.id,
      provider: TALERID_PROVIDER_ID,
      user: { passwordHash: { not: null } },
    },
  });
  if (count === 0) return { formError: "password_required" };

  revalidatePath("/[locale]/me/settings", "page");
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

// ─── Receipt delivery (§46) ───────────────────────────────────────────────

/**
 * §46 "Клиент выбирает способ в настройках; по умолчанию только электронный".
 * An unchecked box is simply absent from a form submit, so both flags are read
 * as presence — otherwise turning one off could never be saved.
 */
export async function updateReceiptDeliveryAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      receiptEmail: formData.get("receiptEmail") != null,
      receiptPush: formData.get("receiptPush") != null,
    },
  });
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

// ─── Name ─────────────────────────────────────────────────────────────────

export async function updateNameAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Не авторизован" };

  const raw = { name: String(formData.get("name") ?? "").trim() };
  const parsed = updateNameSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: { name: parsed.error.issues[0].message } };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name === "" ? null : parsed.data.name },
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
