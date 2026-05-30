import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CancelBuildRequestButton } from "@/components/cabinet/cancel-build-request-button";
import { AcceptClaimButton } from "@/components/matching/accept-claim-button";

export default async function BuildRequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests/${id}`);

  const r = await prisma.buildRequest.findUnique({
    where: { id },
    include: {
      claims: {
        orderBy: { createdAt: "desc" },
        include: {
          contractor: {
            select: {
              id: true, slug: true, displayName: true, city: true, country: true,
              entityType: true, foundedYear: true, bio: true,
              contactEmail: true, contactPhone: true, websiteUrl: true, logoUrl: true,
            },
          },
        },
      },
    },
  });
  if (!r || r.userId !== session.user.id) notFound();

  const t = await getTranslations("cabinet.buildRequest");

  const pendingClaims = r.claims.filter((c) => c.status === "PENDING");
  const acceptedClaim = r.claims.find((c) => c.status === "ACCEPTED");
  const rejectedClaims = r.claims.filter((c) => c.status === "REJECTED");

  return (
    <div className="max-w-2xl">
      <Link href={`/${locale}/me/build-requests`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">
        {t(`field.source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
      </h1>

      <div className="flex items-center gap-4 mb-8">
        <span className={`text-xs px-2 py-1 rounded ${statusClass(r.status)}`}>
          {t(`status.${r.status}`)}
        </span>
        {r.status === "OPEN" && (
          <Link
            href={`/${locale}/me/build-requests/${id}/edit`}
            className="text-sm underline"
          >
            {t("action.edit")}
          </Link>
        )}
        {r.status !== "FULFILLED" && r.status !== "CANCELLED" && (
          <CancelBuildRequestButton id={id} label={t("action.cancel")} locale={locale} />
        )}
      </div>

      {acceptedClaim && (
        <section className="mb-8 border border-hairline rounded-lg p-5 bg-green-50 dark:bg-green-950/20">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            ✓ {t("matched.title")}
          </h2>
          <div className="flex items-start gap-3">
            {acceptedClaim.contractor.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={acceptedClaim.contractor.logoUrl}
                alt={`${acceptedClaim.contractor.displayName} logo`}
                className="w-14 h-14 rounded object-cover border border-hairline"
              />
            ) : (
              <div className="w-14 h-14 rounded bg-foreground/10 flex items-center justify-center font-bold text-xl text-muted">
                {acceptedClaim.contractor.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <p className="font-semibold text-[15px]">{acceptedClaim.contractor.displayName}</p>
              <p className="text-xs text-muted">{acceptedClaim.contractor.city}, {acceptedClaim.contractor.country}</p>
              <dl className="grid grid-cols-[100px_1fr] gap-y-1 text-sm mt-3">
                <dt className="text-muted">Email</dt>
                <dd><a href={`mailto:${acceptedClaim.contractor.contactEmail}`} className="text-accent underline">{acceptedClaim.contractor.contactEmail}</a></dd>
                <dt className="text-muted">Phone</dt>
                <dd><a href={`tel:${acceptedClaim.contractor.contactPhone}`} className="text-accent underline">{acceptedClaim.contractor.contactPhone}</a></dd>
                {acceptedClaim.contractor.websiteUrl && (
                  <>
                    <dt className="text-muted">Web</dt>
                    <dd><a href={acceptedClaim.contractor.websiteUrl} target="_blank" rel="noreferrer" className="text-accent underline">{acceptedClaim.contractor.websiteUrl}</a></dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </section>
      )}

      {pendingClaims.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            {t("claims.title", { count: pendingClaims.length })}
          </h2>
          <ul className="space-y-3">
            {pendingClaims.map((c) => (
              <li key={c.id} className="border border-hairline rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">{c.contractor.displayName}</p>
                    <p className="text-xs text-muted">
                      {c.contractor.city}, {c.contractor.country}
                      {c.contractor.foundedYear ? ` · since ${c.contractor.foundedYear}` : ""}
                    </p>
                    {c.message && <p className="text-sm mt-2 whitespace-pre-wrap">&quot;{c.message}&quot;</p>}
                    <p className="text-xs text-muted mt-2 line-clamp-3">{c.contractor.bio.slice(0, 300)}</p>
                  </div>
                  <AcceptClaimButton
                    claimId={c.id}
                    label={t("claims.accept")}
                    confirmText={t("claims.confirmAccept")}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {acceptedClaim && rejectedClaims.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            {t("matched.rejectedSiblings")} ({rejectedClaims.length})
          </h2>
          <ul className="space-y-2">
            {rejectedClaims.map((c) => (
              <li key={c.id} className="text-sm text-muted">
                · {c.contractor.displayName} — {c.contractor.city}, {c.contractor.country}
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid grid-cols-[200px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("field.country.label")}</dt><dd>{r.country}, {r.city}</dd>
        <dt className="text-muted">{t("field.addressLine.label")}</dt><dd>{r.addressLine}</dd>
        <dt className="text-muted">{t("field.siteType.label")}</dt><dd>{t(`field.siteType.${r.siteType}`)}</dd>
        {r.roofOrientation && <><dt className="text-muted">{t("field.roofOrientation.label")}</dt><dd>{t(`field.roofOrientation.${r.roofOrientation}`)}</dd></>}
        {r.availableAreaM2 != null && <><dt className="text-muted">{t("field.availableAreaM2.label")}</dt><dd>{r.availableAreaM2} m²</dd></>}
        <dt className="text-muted">{t("field.budget.label")}</dt><dd>{t(`field.budget.${r.budget}`)}</dd>
        <dt className="text-muted">{t("field.timeline.label")}</dt><dd>{t(`field.timeline.${r.timeline}`)}</dd>
        {r.wantPowerbank && <><dt className="text-muted">{t("field.powerbankKwh.label")}</dt><dd>{r.powerbankKwh?.toString()} kWh</dd></>}
        {r.wantEvCharger && <><dt className="text-muted">{t("field.evChargerPorts.label")}</dt><dd>{r.evChargerPorts}</dd></>}
        {r.notes && <><dt className="text-muted">{t("field.notes.label")}</dt><dd className="whitespace-pre-wrap">{r.notes}</dd></>}
      </dl>
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "OPEN": return "bg-blue-100 text-blue-700";
    case "MATCHED": return "bg-yellow-100 text-yellow-700";
    case "FULFILLED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
