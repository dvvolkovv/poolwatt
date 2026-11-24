"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/locales";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { TALERID_PROVIDER_ID } from "@/lib/talerid/config";
import { setLinkIntent } from "@/lib/talerid/link-intent-cookie";

function localeFrom(formData: FormData): string {
  const value = String(formData.get("locale") ?? "");
  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? value : DEFAULT_LOCALE;
}

/** Sends the visitor to Taler ID; on failure back to `errorPath` with a message. */
async function goToTalerId(redirectTo: string, errorPath: string): Promise<never> {
  try {
    await signIn(TALERID_PROVIDER_ID, { redirectTo });
  } catch (err) {
    unstable_rethrow(err); // the redirect to Taler ID itself
    console.error("[talerid] could not start sign-in:", err);
  }
  redirect(`${errorPath}?error=Configuration`);
}

export async function signInWithTalerId(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const callbackUrl = formData.get("callbackUrl");
  await goToTalerId(
    safeRedirectPath(typeof callbackUrl === "string" ? callbackUrl : null, `/${locale}/me`),
    `/${locale}/login`,
  );
}

export async function linkTalerId(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/settings`);
  await setLinkIntent(session.user.id);
  await goToTalerId(`/${locale}/me/settings?talerid=linked`, `/${locale}/me/settings`);
}
