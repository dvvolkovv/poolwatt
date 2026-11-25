// The partner's marketing page — ТЗ §41, US-40. Upload, preview, submit to
// moderation, and see what the moderator said.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readNetworkContent } from "@/lib/marketing/content-service";
import { ContentForm } from "@/components/marketing/content-form";
import { ContentRowActions } from "@/components/marketing/content-row-actions";

export const dynamic = "force-dynamic";

export default async function MarketingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/marketing`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  // §41 is the partner's own marketing; an employee has no business in it.
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("marketing");

  const [contents, points] = await Promise.all([
    readNetworkContent(id, session.user.id),
    prisma.acceptancePoint.findMany({
      where: { operatorId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const names = (keys: readonly string[], prefix: string) =>
    Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));

  return (
    <div className="max-w-3xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-8 text-sm text-muted">{t("intro")}</p>

      <section className="mb-12">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("new")}</h2>
        <ContentForm
          operatorId={id}
          points={points}
          labels={{
            type: t("field.type"),
            title: t("field.title"),
            body: t("field.body"),
            linkUrl: t("field.linkUrl"),
            files: t("field.files"),
            filesHintImage: t("field.filesHintImage"),
            filesHintVideo: t("field.filesHintVideo"),
            placements: t("field.placements"),
            audience: t("field.audience"),
            points: t("field.points"),
            pointsAll: t("field.pointsAll"),
            schedule: t("field.schedule"),
            from: t("field.from"),
            to: t("field.to"),
            weekdays: t("field.weekdays"),
            hours: t("field.hours"),
            hoursUtc: t("field.hoursUtc"),
            preview: t("preview"),
            save: t("save"),
            saveAndSubmit: t("saveAndSubmit"),
            types: names(["BANNER", "VIDEO", "GALLERY", "PROMO", "NEWS", "LINK"], "type"),
            placementNames: names(
              ["FULL_CARD", "NAVIGATOR_MINI", "CHARGE_COMPLETE", "PUSH"],
              "placement",
            ),
            audienceNames: names(
              ["ALL", "NEWCOMERS", "REGULARS", "COOP_MEMBERS", "CARD_HOLDERS"],
              "audience",
            ),
            weekdayNames: names(["0", "1", "2", "3", "4", "5", "6"], "weekday"),
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("list")}</h2>
        {contents.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm" data-testid="content-list">
            {contents.map((c) => (
              <li key={c.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-[12px] text-muted">
                    {t(`type.${c.type}`)} · {t(`status.${c.status}`)} ·{" "}
                    <span className="num">{c.assets.length}</span> {t("fileCount")}
                  </span>
                </div>

                <div className="text-[12px] text-muted">
                  {c.placements.length > 0
                    ? c.placements.map((p) => t(`placement.${p}`)).join(", ")
                    : t("nowhere")}
                  {" · "}
                  {t(`audience.${c.audience}`)}
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
                          className="h-24 rounded border border-hairline"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={a.id}
                          src={`/api/v1/marketing/media/${a.id}`}
                          alt={c.title}
                          className="h-24 rounded border border-hairline object-cover"
                        />
                      ),
                    )}
                  </div>
                )}

                {c.status === "REJECTED" && c.reviewNote && (
                  <p className="text-[13px] text-down" data-testid="review-note">
                    {t("rejected")}: {c.reviewNote}
                  </p>
                )}

                <ContentRowActions
                  contentId={c.id}
                  assetIds={c.assets.map((a) => a.id)}
                  canSubmit={c.status !== "REVIEW"}
                  labels={{
                    submit: t("submit"),
                    remove: t("remove"),
                    dropFile: t("dropFile"),
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
