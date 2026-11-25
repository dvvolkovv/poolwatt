import { getTranslations } from "next-intl/server";

/**
 * A screen that is planned but not built says so, and names the stage. An
 * empty page that looks broken costs more trust than an honest one.
 */
export async function Soon({ stage }: { stage: string }) {
  const t = await getTranslations("app.soon");
  return (
    <div className="mt-10 rounded-lg border border-hairline bg-card px-4 py-6">
      <div className="text-[15px] font-semibold">{t("title")}</div>
      <p className="text-[13px] text-muted mt-2">{t("body", { stage })}</p>
    </div>
  );
}
