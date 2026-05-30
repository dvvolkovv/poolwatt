import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExpressInterestForm } from "@/components/matching/express-interest-form";
import { WithdrawClaimButton } from "@/components/matching/withdraw-claim-button";
import type { BuildRequestSource } from "@prisma/client";

const BR_SOURCES: BuildRequestSource[] = ["SOLAR", "WIND", "HYBRID"];

export default async function ContractorRequestsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor/${id}/requests`);

  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      displayName: true,
      countriesServed: true,
      renewableTypes: true,
      members: {
        where: { userId: session.user.id, role: "OWNER" },
        select: { userId: true },
      },
      claims: {
        where: { status: "PENDING" },
        select: { id: true, buildRequestId: true },
      },
    },
  });
  if (!contractor || contractor.members.length === 0) notFound();
  if (contractor.status !== "APPROVED") {
    return (
      <main className="bg-bg min-h-[calc(100vh-4rem)]">
        <div className="max-w-3xl mx-auto px-4 md:px-12 py-12">
          <Link href={`/${locale}/me/contractor/${id}`} className="text-sm text-muted">← Back</Link>
          <h1 className="text-[28px] font-bold mt-4 mb-4">Available requests</h1>
          <p className="text-muted">Your contractor profile must be APPROVED before you can express interest in build requests.</p>
        </div>
      </main>
    );
  }

  const t = await getTranslations("cabinet.contractor.requests");
  const tField = await getTranslations("cabinet.buildRequest.field");

  const claimedBrIds = new Set(contractor.claims.map((c) => c.buildRequestId));
  const matchingSources = contractor.renewableTypes
    .filter((rt): rt is BuildRequestSource => (BR_SOURCES as string[]).includes(rt));

  const requests = await prisma.buildRequest.findMany({
    where: {
      status: "OPEN",
      country: { in: contractor.countriesServed },
      source: { in: matchingSources },
      id: { notIn: Array.from(claimedBrIds) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, source: true, peakKw: true, city: true, country: true, siteType: true,
      roofOrientation: true, budget: true, timeline: true, notes: true, createdAt: true,
      wantPowerbank: true, wantEvCharger: true,
    },
  });

  const myPendingClaims = await prisma.buildRequestClaim.findMany({
    where: { contractorId: id, status: "PENDING" },
    select: {
      id: true,
      message: true,
      createdAt: true,
      buildRequest: {
        select: {
          id: true, source: true, peakKw: true, city: true, country: true, siteType: true, createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-3xl mx-auto px-4 md:px-12 py-12">
        <Link href={`/${locale}/me/contractor/${id}`} className="text-sm text-muted">← {contractor.displayName}</Link>
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] mt-4">{t("title")}</h1>
        <p className="text-muted mt-2">{t("subtitle")}</p>

        {myPendingClaims.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
              {t("youExpressedInterest")} ({myPendingClaims.length})
            </h2>
            <ul className="space-y-3">
              {myPendingClaims.map((c) => (
                <li key={c.id} className="border border-hairline rounded p-4 text-sm bg-card/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <b>{tField(`source.${c.buildRequest.source}`)} · {c.buildRequest.peakKw.toString()} kW</b><br />
                      {c.buildRequest.city}, {c.buildRequest.country} · {tField(`siteType.${c.buildRequest.siteType}`)}
                    </div>
                    <WithdrawClaimButton claimId={c.id} contractorId={id} label={t("withdraw")} />
                  </div>
                  {c.message && <p className="text-muted text-xs mt-2 whitespace-pre-wrap">&quot;{c.message}&quot;</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          {requests.length === 0 ? (
            <p className="text-muted">{t("empty")}</p>
          ) : (
            <ul className="space-y-4">
              {requests.map((r) => (
                <li key={r.id} className="border border-hairline rounded-lg p-5">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="font-medium">
                        {tField(`source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
                      </div>
                      <div className="text-sm text-muted mt-1">
                        {r.city}, {r.country} · {tField(`siteType.${r.siteType}`)}
                        {r.roofOrientation && ` · roof ${r.roofOrientation}`}
                      </div>
                      <div className="text-sm text-muted mt-1">
                        {tField(`budget.${r.budget}`)} · {tField(`timeline.${r.timeline}`)}
                      </div>
                      {(r.wantPowerbank || r.wantEvCharger) && (
                        <div className="flex gap-2 mt-2">
                          {r.wantPowerbank && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-muted">+ powerbank</span>}
                          {r.wantEvCharger && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-muted">+ EV charger</span>}
                        </div>
                      )}
                      {r.notes && <p className="text-xs text-muted mt-3 whitespace-pre-wrap">{r.notes}</p>}
                    </div>
                    <ExpressInterestForm
                      buildRequestId={r.id}
                      contractorId={id}
                      labels={{
                        expressInterest: t("expressInterest"),
                        messageLabel: t("message.label"),
                        messagePlaceholder: t("message.placeholder"),
                        submit: t("submit"),
                        submitting: t("submitting"),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
