import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExpressForm } from "./express-form";
import { WithdrawButton } from "./withdraw-button";

type Props = { params: Promise<{ locale: string; id: string }> };

// Map producer primarySource to matching BR sources. HYBRID matches all three.
function matchingBRSources(primarySource: string): ("SOLAR" | "WIND" | "HYBRID")[] {
  if (primarySource === "HYBRID") return ["SOLAR", "WIND", "HYBRID"];
  if (primarySource === "SOLAR") return ["SOLAR", "HYBRID"];
  if (primarySource === "WIND") return ["WIND", "HYBRID"];
  return [];
}

export default async function ProducerRequestsPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/producer/${id}/requests`);

  const producer = await prisma.producer.findUnique({
    where: { id },
    select: {
      id: true, claimedById: true, displayName: true, country: true, primarySource: true,
    },
  });
  if (!producer || producer.claimedById !== session.user.id) notFound();

  const t = await getTranslations("cabinet.producer.requests");

  const sources = matchingBRSources(producer.primarySource);

  const myClaims = await prisma.producerBuildRequestClaim.findMany({
    where: { producerId: producer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, message: true, createdAt: true,
      buildRequest: {
        select: { id: true, source: true, peakKw: true, city: true, country: true, status: true },
      },
    },
  });

  const claimedBrIds = new Set(myClaims.map((c) => c.buildRequest.id));

  const openRequests = await prisma.buildRequest.findMany({
    where: {
      status: "OPEN",
      country: producer.country,
      source: { in: sources },
      id: { notIn: Array.from(claimedBrIds) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, source: true, peakKw: true, city: true, country: true,
      siteType: true, roofOrientation: true, budget: true, timeline: true,
      notes: true, createdAt: true,
    },
  });

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href={`/${locale}/me/producer/${id}`} className="text-sm text-muted hover:text-foreground">← {t("back")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle", { name: producer.displayName })}</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("openSection")}</h2>
        {openRequests.length === 0 ? (
          <p className="text-sm text-muted">{t("noOpen")}</p>
        ) : (
          <ul className="space-y-3">
            {openRequests.map((br) => (
              <li key={br.id} className="bg-card border border-hairline rounded-xl p-4">
                <div className="text-sm font-semibold">{br.source} · {br.peakKw.toString()} kW</div>
                <div className="text-xs text-muted mt-1">{br.city}, {br.country} · {br.siteType} · {br.budget} · {br.timeline}</div>
                {br.notes && <p className="text-xs text-muted-strong mt-2 line-clamp-2">{br.notes}</p>}
                <ExpressForm
                  producerId={producer.id}
                  buildRequestId={br.id}
                  labels={{ message: t("messagePlaceholder"), submit: t("expressSubmit"), submitting: t("expressSubmitting") }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("myClaimsSection")}</h2>
        {myClaims.length === 0 ? (
          <p className="text-sm text-muted">{t("noClaims")}</p>
        ) : (
          <ul className="space-y-3">
            {myClaims.map((claim) => (
              <li key={claim.id} className="bg-card border border-hairline rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{claim.buildRequest.source} · {claim.buildRequest.peakKw.toString()} kW · {claim.buildRequest.city}, {claim.buildRequest.country}</div>
                    <div className="text-xs text-muted mt-1">
                      {t("status")}: <span className="font-semibold">{claim.status}</span>
                    </div>
                    {claim.message && <p className="text-xs text-muted-strong mt-2 italic">"{claim.message}"</p>}
                  </div>
                  {claim.status === "PENDING" && (
                    <WithdrawButton
                      producerId={producer.id}
                      claimId={claim.id}
                      labels={{ button: t("withdraw"), confirm: t("withdrawConfirm") }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
