#!/usr/bin/env tsx
// Top-level seed runner: populates Producer + ProducerProfile from the mock
// arrays. Idempotent — safe to re-run after deploy. Invoked via
// `npm run db:seed`.

import { prisma } from "@/lib/prisma";
import { MOCK_PRODUCERS } from "@/lib/producers";
import { PRODUCER_PROFILES } from "@/lib/producer-profiles";
import { seedProducers } from "@/lib/seed/producers";
import { seedProducerProfiles } from "@/lib/seed/producer-profiles";

async function main() {
  console.log(`[seed] producers: starting (${MOCK_PRODUCERS.length} rows in source)`);
  const p = await seedProducers(prisma, MOCK_PRODUCERS);
  console.log(`[seed] producers: created=${p.created}, skipped=${p.skipped}`);

  console.log(`[seed] producer profiles: starting (${Object.keys(PRODUCER_PROFILES).length} entries in source)`);
  const pp = await seedProducerProfiles(prisma, PRODUCER_PROFILES);
  console.log(`[seed] producer profiles: created=${pp.created}, skipped=${pp.skipped}`);

  console.log(`[seed] done`);
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
