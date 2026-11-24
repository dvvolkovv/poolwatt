import { getTranslations } from "next-intl/server";
import { signInWithTalerId } from "@/app/actions/talerid";
import { isTalerIdEnabled, TALERID_SIGNUP_URL } from "@/lib/talerid/config";
import type { TalerIdErrorKey } from "@/lib/talerid/errors";
import { TalerIdSubmit } from "./talerid-submit";

/** Taler ID button above the nickname form; nothing when Taler ID is not configured. */
export async function TalerIdPanel({
  locale,
  mode,
  callbackUrl,
  errorKey = null,
}: {
  locale: string;
  mode: "signIn" | "continue";
  callbackUrl?: string;
  errorKey?: TalerIdErrorKey | null;
}) {
  if (!isTalerIdEnabled()) return null;
  const t = await getTranslations("auth.talerId");

  return (
    <div className="space-y-4">
      {errorKey && (
        <p role="alert" className="text-sm text-down">
          {t(`errors.${errorKey}`)}
        </p>
      )}
      <form action={signInWithTalerId}>
        <input type="hidden" name="locale" value={locale} />
        {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
        <TalerIdSubmit label={t(mode)} pendingLabel={t("pending")} />
      </form>
      <p className="text-xs text-muted text-center">
        {t("noTalerId")}{" "}
        <a
          href={TALERID_SIGNUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {t("create")}
        </a>
      </p>
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted">
        <span className="h-px flex-1 bg-hairline" aria-hidden />
        {t("or")}
        <span className="h-px flex-1 bg-hairline" aria-hidden />
      </div>
    </div>
  );
}
