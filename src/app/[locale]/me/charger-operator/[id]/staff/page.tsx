// Staff of one network — ТЗ §47, US-47.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInRoles } from "@/lib/staff/staff-service";
import { StaffTable } from "@/components/staff/staff-table";

export const dynamic = "force-dynamic";

export default async function StaffPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/staff`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  // §47 — only the owner hands out roles.
  if (operator.claimedById !== session.user.id && session.user.role !== "ADMIN") notFound();

  const t = await getTranslations("staff");

  const roles = await ensureBuiltInRoles(id);
  const [employees, points] = await Promise.all([
    prisma.employee.findMany({
      where: { operatorId: id },
      orderBy: { createdAt: "asc" },
      include: { role: true, user: { select: { username: true } } },
    }),
    prisma.acceptancePoint.findMany({
      where: { operatorId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">
        {t("eyebrow")}
      </div>
      <h1 className="mb-6 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-6 max-w-[80ch] text-[13px] text-muted">{t("help")}</p>

      <StaffTable
        operatorId={id}
        employees={employees.map((e) => ({
          id: e.id,
          username: e.user.username,
          roleName: e.role.name,
          permissions: e.role.permissions,
          pointIds: e.pointIds,
        }))}
        roles={roles.map((r) => ({ name: r.name, permissions: r.permissions }))}
        points={points}
        labels={{
          invite: t("invite"),
          username: t("username"),
          role: t("role"),
          scope: t("scope"),
          wholeNetwork: t("wholeNetwork"),
          add: t("add"),
          save: t("save"),
          remove: t("remove"),
          empty: t("empty"),
          permissions: t("permissions"),
          roleNames: Object.fromEntries(
            roles.map((r) => [r.name, t(`roleName.${r.name}`)]),
          ),
        }}
      />
    </div>
  );
}
