"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

export type LoginFormState = {
  fieldErrors?: { username?: string; password?: string };
  formError?: string;
};

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const raw = {
    username: String(formData.get("username") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const f: LoginFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "username" || key === "password") f[key] = issue.message;
    }
    return { fieldErrors: f };
  }

  const locale = String(formData.get("locale") ?? "en");
  const callbackUrl = String(formData.get("callbackUrl") ?? `/${locale}/me`);

  try {
    await signIn("credentials", {
      username: parsed.data.username,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (err) {
    // Auth.js throws a NEXT_REDIRECT on success — that one we re-throw.
    if (
      err instanceof Error &&
      "digest" in err &&
      typeof err.digest === "string" &&
      err.digest.startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    if (err instanceof AuthError) {
      return { formError: "Неверный ник или пароль" };
    }
    throw err;
  }

  // Unreachable — signIn() always redirects on success.
  return {};
}
