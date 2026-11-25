// The operator's queue for partner content — ТЗ §41, US-40.

import { getTranslations, setRequestLocale } from "next-intl/server";
import { readReviewQueue } from "@/lib/marketing/content-service";
import { DecideContent } from "@/components/marketing/decide-content";

export const dynamic = "force-dynamic";

export default async function AdminMarketingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("marketing");
  const rows = await readReviewQueue();

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{t("adminTitle")}</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("adminEmpty")}</p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="admin-content-queue">
          {rows.map((c) => (
            <li key={c.id} className="space-y-3 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[15px] font-medium">{c.title}</span>
                <span className="text-[12px] text-muted">
                  {c.operator.displayName} · {t(`type.${c.type}`)} · {t(`audience.${c.audience}`)}
                </span>
              </div>

              {c.body && <p className="whitespace-pre-line text-sm text-muted">{c.body}</p>}
              {c.linkUrl && (
                <p className="text-[13px]">
                  <a
                    href={c.linkUrl}
                    rel="noreferrer noopener nofollow"
                    target="_blank"
                    className="underline hover:text-accent"
                  >
                    {c.linkUrl}
                  </a>
                </p>
              )}

              <div className="text-[12px] text-muted">
                {c.placements.map((p) => t(`placement.${p}`)).join(", ") || t("nowhere")}
                {" · "}
                {c.pointIds.length === 0
                  ? t("wholeNetwork")
                  : `${c.pointIds.length} ${t("pointCount")}`}
              </div>

              {c.assets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {c.assets.map((a) =>
                    a.contentType.startsWith("video/") ? (
                      <video
                        key={a.id}
                        src={`/api/v1/marketing/media/${a.id}`}
                        controls
                        className="h-32 rounded border border-hairline"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={a.id}
                        src={`/api/v1/marketing/media/${a.id}`}
                        alt={c.title}
                        className="h-32 rounded border border-hairline object-cover"
                      />
                    ),
                  )}
                </div>
              )}

              <DecideContent
                contentId={c.id}
                labels={{ approve: t("approve"), reject: t("reject"), note: t("note") }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
