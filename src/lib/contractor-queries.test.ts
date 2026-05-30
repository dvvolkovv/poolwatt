import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  readApprovedContractors,
  readContractorBySlug,
  readNewestApprovedContractors,
} from "./contractor-queries";

const PREFIX = "test_pub_";

async function seedUser(username: string) {
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
}

async function seedContractor(opts: {
  slug: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  country: string;
  renewables: ("SOLAR" | "WIND" | "HYDRO" | "BIOMASS" | "GEOTHERMAL" | "HYBRID")[];
  daysAgo?: number;
}) {
  const ownerUsername = `${PREFIX}owner_${opts.slug}`;
  const owner = await seedUser(ownerUsername);
  const created = await prisma.contractor.create({
    data: {
      slug: `${PREFIX}${opts.slug}`,
      entityType: "INDIVIDUAL",
      displayName: `Test ${opts.slug}`,
      country: opts.country,
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: opts.renewables,
      countriesServed: [opts.country],
      bio: "x".repeat(150),
      contactEmail: `info@${opts.slug}.test`,
      contactPhone: "+421900000000",
      adminNote: "SECRET-internal-note-should-never-leak",
      status: opts.status,
    },
  });
  await prisma.contractorMember.create({
    data: { contractorId: created.id, userId: owner.id, role: "OWNER" },
  });
  if (opts.daysAgo) {
    const date = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
    await prisma.contractor.update({ where: { id: created.id }, data: { createdAt: date } });
  }
  return created;
}

beforeAll(async () => {
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });

  await seedContractor({ slug: "a-approved-sk-solar", status: "APPROVED", country: "SK", renewables: ["SOLAR"], daysAgo: 5 });
  await seedContractor({ slug: "b-approved-cz-wind", status: "APPROVED", country: "CZ", renewables: ["WIND"], daysAgo: 3 });
  await seedContractor({ slug: "c-approved-sk-wind-solar", status: "APPROVED", country: "SK", renewables: ["WIND", "SOLAR"], daysAgo: 1 });
  await seedContractor({ slug: "d-pending-sk", status: "PENDING", country: "SK", renewables: ["SOLAR"] });
  await seedContractor({ slug: "e-rejected-sk", status: "REJECTED", country: "SK", renewables: ["SOLAR"] });
  await seedContractor({ slug: "f-suspended-sk", status: "SUSPENDED", country: "SK", renewables: ["SOLAR"] });
});

describe("readApprovedContractors — EV filter", () => {
  it("includes EV fields in PUBLIC_SELECT", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.length).toBeGreaterThan(0);
    for (const r of ours) {
      expect(r).toHaveProperty("providesEvCharging");
      expect(r).toHaveProperty("evPowerSource");
      expect(r).toHaveProperty("evConnectorTypes");
    }
  });

  it("filters to EV-only when ev=true", async () => {
    // mark one of our seeded approved contractors as EV
    const target = await prisma.contractor.findFirstOrThrow({
      where: { slug: `${PREFIX}a-approved-sk-solar` },
    });
    await prisma.contractor.update({
      where: { id: target.id },
      data: {
        providesEvCharging: true,
        evPowerSource: "MIXED",
        evStationCount: 3,
        evConnectorTypes: ["TYPE2"],
        evPowerLevels: ["AC_FAST"],
        evUsageType: "PUBLIC",
        evMaxPowerKw: 22,
        evDescription: "Three Type 2 AC stations powered by our rooftop solar plus grid backup for visitors.",
      },
    });

    const { rows } = await readApprovedContractors({ ev: true, pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.length).toBe(1);
    expect(ours[0].slug).toBe(`${PREFIX}a-approved-sk-solar`);

    // restore
    await prisma.contractor.update({
      where: { id: target.id },
      data: { providesEvCharging: false },
    });
  });
});

afterAll(async () => {
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("readApprovedContractors", () => {
  it("returns only APPROVED rows", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    const ourRows = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ourRows).toHaveLength(3);
    for (const r of ourRows) {
      expect(["a-approved-sk-solar", "b-approved-cz-wind", "c-approved-sk-wind-solar"].some((s) => r.slug.endsWith(s))).toBe(true);
    }
  });

  it("does NOT include adminNote", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    for (const r of rows) {
      expect((r as Record<string, unknown>).adminNote).toBeUndefined();
    }
  });

  it("filters by country", async () => {
    const { rows, total } = await readApprovedContractors({ country: "CZ", pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours).toHaveLength(1);
    expect(ours[0].slug.endsWith("b-approved-cz-wind")).toBe(true);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("filters by renewable (has) matches contractors that include the type", async () => {
    const { rows } = await readApprovedContractors({ renewable: "WIND", pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.map((r) => r.slug.replace(PREFIX, "")).sort()).toEqual(
      ["b-approved-cz-wind", "c-approved-sk-wind-solar"].sort(),
    );
  });

  it("sorts newest first (createdAt DESC)", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours[0].slug.endsWith("c-approved-sk-wind-solar")).toBe(true);
  });

  it("caps pageSize at 50 (defensive)", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 99999 });
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});

describe("readContractorBySlug", () => {
  it("returns an APPROVED contractor by slug", async () => {
    const r = await readContractorBySlug(`${PREFIX}a-approved-sk-solar`);
    expect(r).not.toBeNull();
    expect(r!.slug).toBe(`${PREFIX}a-approved-sk-solar`);
  });

  it("returns null for non-APPROVED slug", async () => {
    expect(await readContractorBySlug(`${PREFIX}d-pending-sk`)).toBeNull();
    expect(await readContractorBySlug(`${PREFIX}e-rejected-sk`)).toBeNull();
    expect(await readContractorBySlug(`${PREFIX}f-suspended-sk`)).toBeNull();
  });

  it("returns null for non-existent slug", async () => {
    expect(await readContractorBySlug(`${PREFIX}does-not-exist`)).toBeNull();
  });

  it("does NOT include adminNote", async () => {
    const r = await readContractorBySlug(`${PREFIX}a-approved-sk-solar`);
    expect((r as Record<string, unknown>).adminNote).toBeUndefined();
  });
});

describe("readNewestApprovedContractors", () => {
  it("returns newest APPROVED only", async () => {
    const rows = await readNewestApprovedContractors(50);
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.map((r) => r.slug.replace(PREFIX, ""))).toEqual([
      "c-approved-sk-wind-solar",
      "b-approved-cz-wind",
      "a-approved-sk-solar",
    ]);
  });

  it("limits to `limit`", async () => {
    const rows = await readNewestApprovedContractors(1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
