import { prisma } from "@/lib/prisma";
import type { ContractorRenewableType, Prisma } from "@prisma/client";

// Public-safe SELECT — explicitly excludes adminNote, reviewedById, reviewedAt.
const PUBLIC_SELECT = {
  id: true,
  slug: true,
  entityType: true,
  displayName: true,
  legalName: true,
  registrationNumber: true,
  country: true,
  city: true,
  foundedYear: true,
  workCategories: true,
  renewableTypes: true,
  countriesServed: true,
  bio: true,
  websiteUrl: true,
  logoUrl: true,
  contactEmail: true,
  contactPhone: true,
  createdAt: true,
  updatedAt: true,
  providesEvCharging: true,
  evPowerSource: true,
  evStationCount: true,
  evConnectorTypes: true,
  evPowerLevels: true,
  evUsageType: true,
  evMaxPowerKw: true,
  evDescription: true,
} as const;

export type PublicContractor = Prisma.ContractorGetPayload<{
  select: typeof PUBLIC_SELECT;
}>;

export type PublicContractorList = {
  rows: PublicContractor[];
  total: number;
};

export async function readContractorBySlug(slug: string) {
  return prisma.contractor.findFirst({
    where: { slug, status: "APPROVED" },
    select: PUBLIC_SELECT,
  });
}

export async function readApprovedContractors(args: {
  country?: string;
  renewable?: ContractorRenewableType;
  ev?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<PublicContractorList> {
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, args.pageSize ?? 24));
  const where = {
    status: "APPROVED" as const,
    ...(args.country ? { country: args.country } : {}),
    ...(args.renewable ? { renewableTypes: { has: args.renewable } } : {}),
    ...(args.ev === true ? { providesEvCharging: true } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.contractor.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: PUBLIC_SELECT,
    }),
    prisma.contractor.count({ where }),
  ]);
  return { rows, total };
}

export async function readNewestApprovedContractors(limit = 6) {
  return prisma.contractor.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: PUBLIC_SELECT,
  });
}
