import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const contractors = await prisma.contractor.findMany({
    where: { status: "APPROVED" },
    select: { slug: true, updatedAt: true },
  });

  const now = new Date();
  return [
    { url: `${BASE}/en`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE}/en/contractors`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...contractors.map((c) => ({
      url: `${BASE}/en/contractors/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
