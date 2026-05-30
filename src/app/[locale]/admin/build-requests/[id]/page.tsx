import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";
import { StatusChangeForm } from "@/components/admin/status-change-form";

const NEXT: Record<BuildRequestStatus, BuildRequestStatus[]> = {
  OPEN: ["MATCHED", "CANCELLED"],
  MATCHED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export default async function AdminBuildRequestDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const r = await prisma.buildRequest.findUnique({
    where: { id },
    include: { user: { select: { username: true, name: true, email: true, phone: true } } },
  });
  if (!r) notFound();

  const t = await getTranslations("admin.buildRequest");

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/${locale}/admin/build-requests`} className="text-sm text-muted">← Back</Link>
      <h1 className="text-[28px] font-bold">Request #{r.id.slice(0, 8)}</h1>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Owner</h2>
        <p><b>@{r.user.username}</b> ({r.user.name ?? "—"})</p>
        <p>Email: {r.user.email ?? "—"}</p>
        <p>Phone: {r.user.phone ?? "—"}</p>
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Request</h2>
        <p>{r.source} · <span className="num">{r.peakKw.toString()}</span> kW</p>
        <p>{r.country}, {r.city} — {r.addressLine}</p>
        <p>Site: {r.siteType}{r.roofOrientation ? ` · roof ${r.roofOrientation}` : ""}</p>
        {r.availableAreaM2 != null && <p>Area: {r.availableAreaM2} m²</p>}
        {r.wantPowerbank && <p>Powerbank: {r.powerbankKwh?.toString()} kWh</p>}
        {r.wantEvCharger && (
          <p>EV charger: {r.evChargerPorts} ports{r.evPublicForSale ? ", public" : ""}</p>
        )}
        <p>Budget: {r.budget} · Timeline: {r.timeline}</p>
        {r.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{r.notes}</p>}
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Status</h2>
        <p>Current: <b>{r.status}</b></p>
        {r.adminNote && <p className="text-sm text-muted mt-2">Note: {r.adminNote}</p>}
      </section>

      <StatusChangeForm
        id={r.id}
        currentStatus={r.status}
        allowedNext={NEXT[r.status]}
        labels={{
          setStatus: t("action.setStatus"),
          adminNote: t("action.adminNote"),
          submit: t("action.submit"),
        }}
      />
    </div>
  );
}
