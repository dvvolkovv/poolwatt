import { notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { MOCK_PRODUCERS } from "@/lib/producers";
import { prisma } from "@/lib/prisma";
import { mergeProducer } from "@/lib/merge-producer";
import { formatKwh } from "@/lib/format";
import { Sparkline } from "@/components/sparkline";
import { SourceBadge } from "@/components/source-badge";
import { StateOfCharge } from "@/components/state-of-charge";
import {
  Globe,
  Mail,
  Phone,
  MapPin,
  Building2,
  Users,
  Calendar,
  Award,
  ExternalLink,
  ArrowLeft,
  Zap,
  Factory,
  TrendingUp,
} from "lucide-react";

export const revalidate = 60;

type Props = {
  params: Promise<{ locale: string; handle: string }>;
  searchParams: Promise<{ claimed?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { handle } = await params;
  const producer = await prisma.producer.findUnique({
    where: { handle },
    select: { displayName: true, primarySource: true, city: true, country: true },
  });
  if (!producer) return { title: "Not Found — Poolwatt" };
  return {
    title: `${producer.displayName} — Poolwatt`,
    description: `${producer.displayName} — renewable energy producer on the Poolwatt grid. ${producer.primarySource} · ${producer.city ?? ""}, ${producer.country}`,
  };
}

export default async function ProducerPage({ params, searchParams }: Props) {
  const { locale, handle } = await params;
  const { claimed } = await searchParams;
  setRequestLocale(locale);

  const dbProducer = await prisma.producer.findUnique({
    where: { handle },
    include: { profile: true },
  });
  if (!dbProducer) notFound();

  const snapshot = MOCK_PRODUCERS.find((m) => m.handle === handle);
  if (!snapshot) notFound();

  const producer = mergeProducer(dbProducer, snapshot);
  const profile = producer.profile ?? null;
  const isOEM = producer.category === "EQUIPMENT_MANUFACTURER";

  const isClaimed = dbProducer.claimedById !== null;
  const justClaimed = claimed === "1" && isClaimed;

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-12 xl:px-20 py-8">
      {justClaimed && (
        <div className="mb-6 p-4 rounded-xl bg-up/10 border border-up/30 text-sm">
          ✓ You've claimed this card. The editing UI is coming in R3c.
        </div>
      )}
      <Link
        href={`/${locale}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Back to grid
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{producer.displayName}</h1>
            {isOEM && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                Equipment Manufacturer
              </span>
            )}
            {isClaimed && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-up/10 text-up border border-up/30">
                ✓ Verified
              </span>
            )}
          </div>
          <p className="text-muted text-sm">
            @{producer.handle} · {producer.city}, {producer.country}
          </p>
          {profile && (
            <p className="text-muted-strong text-sm mt-3 max-w-[700px] leading-relaxed">
              {profile.description}
            </p>
          )}
          {!isClaimed && (
            <Link
              href={`/${locale}/me/claim/PRODUCER/${dbProducer.id}`}
              className="inline-block mt-4 text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/5 transition-colors"
            >
              This is our company — claim this card
            </Link>
          )}
        </div>
        <div className="shrink-0">
          <SourceBadge source={producer.primarySource} />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Capacity" value={formatKwh(producer.capacityKwh)} icon={<Zap size={14} />} />
        <StatCard label="Inverter" value={`${producer.inverterKw} kW`} icon={<TrendingUp size={14} />} />
        <StatCard label="Delivered (lifetime)" value={formatKwh(producer.deliveredLifetimeKwh)} icon={<Factory size={14} />} />
        <StatCard label="Uptime" value={`${producer.uptimePct}%`} icon={<Award size={14} />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-hairline rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">State of Charge</div>
          <StateOfCharge pct={producer.stateOfChargePct} />
          <div className="num text-lg font-bold mt-1">{producer.stateOfChargePct}%</div>
        </div>
        <div className="bg-card border border-hairline rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Price / kWh</div>
          <div className="num text-lg font-bold text-accent">${producer.pricePerKwhUsd.toFixed(4)}</div>
        </div>
        <div className="bg-card border border-hairline rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">7-Day Output</div>
          <Sparkline data={producer.weeklyOutput} width={180} height={40} />
        </div>
      </div>

      {/* Equipment / Manufactures */}
      {producer.equipment && producer.equipment.length > 0 && (
        <Section title="Equipment & Components">
          <div className="flex flex-wrap gap-2">
            {producer.equipment.map((eq) => (
              <span key={eq} className="text-xs px-3 py-1.5 rounded-full bg-card border border-hairline text-foreground">
                {eq}
              </span>
            ))}
          </div>
        </Section>
      )}

      {producer.manufactures && producer.manufactures.length > 0 && (
        <Section title="Products Manufactured">
          <div className="flex flex-wrap gap-2">
            {producer.manufactures.map((m) => (
              <span key={m} className="text-xs px-3 py-1.5 rounded-full bg-accent/5 border border-accent/20 text-accent">
                {m}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Profile / Contact */}
      {profile && (
        <>
          <Section title="Company Info">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoRow icon={<Calendar size={14} />} label="Founded" value={String(profile.founded)} />
              <InfoRow icon={<Users size={14} />} label="Employees" value={profile.employees} />
              <InfoRow icon={<Building2 size={14} />} label="CEO" value={profile.ceo} />
              {profile.stockTicker && (
                <InfoRow icon={<TrendingUp size={14} />} label="Stock" value={profile.stockTicker} />
              )}
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoRow
                icon={<Globe size={14} />}
                label="Website"
                value={
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                    {profile.website.replace("https://", "").replace("http://", "")}
                    <ExternalLink size={10} />
                  </a>
                }
              />
              <InfoRow
                icon={<Mail size={14} />}
                label="Email"
                value={
                  <a href={`mailto:${profile.email}`} className="text-accent hover:underline">
                    {profile.email}
                  </a>
                }
              />
              <InfoRow icon={<Phone size={14} />} label="Phone" value={profile.phone} />
              <InfoRow icon={<MapPin size={14} />} label="Address" value={profile.address} />
            </div>
          </Section>

          {profile.certifications.length > 0 && (
            <Section title="Certifications">
              <div className="flex flex-wrap gap-2">
                {profile.certifications.map((c) => (
                  <span key={c} className="text-[11px] px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {c}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {profile.keyProducts.length > 0 && (
            <Section title="Key Products">
              <div className="flex flex-wrap gap-2">
                {profile.keyProducts.map((p) => (
                  <span key={p} className="text-xs px-3 py-1.5 rounded-full bg-card border border-hairline text-foreground">
                    {p}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {!profile && (
        <div className="bg-card border border-hairline rounded-xl p-8 text-center text-muted">
          Detailed company profile coming soon.
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted mb-4">{title}</h2>
      {children}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-hairline rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1">
        {icon} {label}
      </div>
      <div className="num text-lg font-bold text-foreground">{value}</div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="text-muted mt-0.5">{icon}</div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
        <div className="text-sm text-foreground mt-0.5">{value}</div>
      </div>
    </div>
  );
}
