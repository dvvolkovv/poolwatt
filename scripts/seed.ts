#!/usr/bin/env tsx
// Top-level seed runner: populates Producer + ProducerProfile from the mock
// arrays. Idempotent — safe to re-run after deploy. Invoked via
// `npm run db:seed`.

import { prisma } from "@/lib/prisma";
import { MOCK_PRODUCERS } from "@/lib/producers";
import { PRODUCER_PROFILES } from "@/lib/producer-profiles";
import { seedProducers } from "@/lib/seed/producers";
import { seedProducerProfiles } from "@/lib/seed/producer-profiles";
import { seedChargerOperators, CHARGER_OPERATOR_SEED } from "@/lib/seed/charger-operators";
import {
  FEE_PLAN_SEED,
  GRID_ZONE_SEED,
  seedFeePlans,
  seedGridZones,
} from "@/lib/seed/grid-zones";
import { ROAMING_AGREEMENT_SEED, seedRoamingAgreements } from "@/lib/seed/roaming";

async function main() {
  console.log(`[seed] producers: starting (${MOCK_PRODUCERS.length} rows in source)`);
  const p = await seedProducers(prisma, MOCK_PRODUCERS);
  console.log(`[seed] producers: created=${p.created}, skipped=${p.skipped}`);

  const profileSourceCount = Object.keys(PRODUCER_PROFILES).length;
  console.log(`[seed] producer profiles: starting (${profileSourceCount} entries in source)`);
  const pp = await seedProducerProfiles(prisma, PRODUCER_PROFILES);
  console.log(`[seed] producer profiles: created=${pp.created}, skipped=${pp.skipped}`);
  const dropped = profileSourceCount - (pp.created + pp.skipped);
  if (dropped > 0) {
    console.warn(`[seed] WARN: ${dropped} profile(s) silently dropped — handle has no matching Producer row. Check PRODUCER_PROFILES keys against MOCK_PRODUCERS handles.`);
  }

  console.log(`[seed] charger operators: starting (${CHARGER_OPERATOR_SEED.length} rows in source)`);
  const co = await seedChargerOperators(prisma, CHARGER_OPERATOR_SEED);
  console.log(`[seed] charger operators: created=${co.created}, skipped=${co.skipped}`);

  console.log(`[seed] grid zones: starting (${GRID_ZONE_SEED.length} rows in source)`);
  const gz = await seedGridZones(prisma, GRID_ZONE_SEED);
  console.log(`[seed] grid zones: created=${gz.created}, skipped=${gz.skipped}`);

  console.log(`[seed] fee plans: starting (${FEE_PLAN_SEED.length} rows in source)`);
  const fp = await seedFeePlans(prisma, FEE_PLAN_SEED);
  console.log(`[seed] fee plans: created=${fp.created}, skipped=${fp.skipped}`);

  console.log(`[seed] roaming agreements: starting (${ROAMING_AGREEMENT_SEED.length} rows in source)`);
  const ra = await seedRoamingAgreements(prisma, ROAMING_AGREEMENT_SEED);
  console.log(`[seed] roaming agreements: created=${ra.created}, skipped=${ra.skipped}`);

  console.log(`[seed] done`);
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
