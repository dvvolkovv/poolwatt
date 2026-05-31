import type { PrismaClient } from "@prisma/client";
import type { SeedResult } from "./producers";

export type ChargerOperatorSeedRow = {
  slug: string;
  displayName: string;
  aliases: string[];
  websiteUrl?: string | null;
  description?: string | null;
};

export async function seedChargerOperators(
  prisma: PrismaClient,
  rows: ChargerOperatorSeedRow[],
): Promise<SeedResult> {
  const data = rows.map((r) => ({
    slug: r.slug,
    displayName: r.displayName,
    aliases: r.aliases,
    websiteUrl: r.websiteUrl ?? null,
    description: r.description ?? null,
  }));
  const result = await prisma.chargerOperator.createMany({ data, skipDuplicates: true });
  return { created: result.count, skipped: rows.length - result.count };
}

// Curated from the 32 distinct operators in src/lib/chargers-mock.ts.
// `aliases` lists every spelling found in OSM/mock data so a single row
// matches all stations of the same network. `websiteUrl` is hand-curated.
export const CHARGER_OPERATOR_SEED: ChargerOperatorSeedRow[] = [
  { slug: "tesla", displayName: "Tesla", aliases: ["Tesla", "Tesla Supercharger", "Tesla, Inc."], websiteUrl: "https://www.tesla.com" },
  { slug: "ionity", displayName: "IONITY", aliases: ["IONITY"], websiteUrl: "https://ionity.eu" },
  { slug: "electrify-america", displayName: "Electrify America", aliases: ["Electrify America"], websiteUrl: "https://www.electrifyamerica.com" },
  { slug: "chargepoint", displayName: "ChargePoint", aliases: ["ChargePoint"], websiteUrl: "https://www.chargepoint.com" },
  { slug: "enbw", displayName: "EnBW", aliases: ["EnBW"], websiteUrl: "https://www.enbw.com" },
  { slug: "totalenergies", displayName: "TotalEnergies", aliases: ["TotalEnergies", "Total"], websiteUrl: "https://totalenergies.com" },
  { slug: "bp-pulse", displayName: "BP Pulse", aliases: ["BP Pulse", "BP"], websiteUrl: "https://www.bppulse.com" },
  { slug: "circle-k-mer", displayName: "Circle K / Mer", aliases: ["Circle K / Mer", "Circle K", "Mer"], websiteUrl: "https://www.circlek.com" },
  { slug: "chargefox", displayName: "Chargefox", aliases: ["Chargefox"], websiteUrl: "https://www.chargefox.com" },
  { slug: "nio", displayName: "NIO", aliases: ["NIO"], websiteUrl: "https://www.nio.com" },
  { slug: "state-grid", displayName: "State Grid", aliases: ["State Grid"], websiteUrl: "https://www.sgcc.com.cn" },
  { slug: "tepco", displayName: "TEPCO", aliases: ["TEPCO"], websiteUrl: "https://www.tepco.co.jp" },
  { slug: "hyundai", displayName: "Hyundai", aliases: ["Hyundai", "Hyundai E-pit"], websiteUrl: "https://www.hyundai.com" },
  { slug: "tata-power", displayName: "Tata Power", aliases: ["Tata Power"], websiteUrl: "https://www.tatapower.com" },
  { slug: "dewa", displayName: "DEWA", aliases: ["DEWA"], websiteUrl: "https://www.dewa.gov.ae" },
  { slug: "tupinamba", displayName: "Tupinambá", aliases: ["Tupinambá"], websiteUrl: null },
  { slug: "gridcars", displayName: "GridCars", aliases: ["GridCars"], websiteUrl: "https://www.gridcars.net" },
  { slug: "zes", displayName: "ZES (Zorlu)", aliases: ["ZES (Zorlu)", "ZES"], websiteUrl: "https://zes.net" },
  { slug: "electromin", displayName: "Electromin", aliases: ["Electromin"], websiteUrl: null },
  { slug: "energy-absolute", displayName: "Energy Absolute", aliases: ["Energy Absolute"], websiteUrl: "https://www.energyabsolute.co.th" },
  { slug: "petro-canada", displayName: "Petro-Canada", aliases: ["Petro-Canada"], websiteUrl: "https://www.petro-canada.ca" },
  { slug: "aqniet", displayName: "AQNIET", aliases: ["AQNIET"], websiteUrl: null },
  { slug: "uzcharge", displayName: "UzCharge", aliases: ["UzCharge"], websiteUrl: null },
  { slug: "ev-point-georgia", displayName: "EV Point Georgia", aliases: ["EV Point Georgia"], websiteUrl: null },
  { slug: "greenway", displayName: "GreenWay", aliases: ["GreenWay"], websiteUrl: "https://greenway.sk" },
  { slug: "kaufland", displayName: "Kaufland", aliases: ["Kaufland"], websiteUrl: "https://www.kaufland.de" },
  { slug: "lidl", displayName: "Lidl", aliases: ["Lidl"], websiteUrl: "https://www.lidl.com" },
  { slug: "mol-plugee", displayName: "MOL Plugee", aliases: ["MOL Plugee", "MOL"], websiteUrl: "https://molgroup.info" },
  { slug: "omv", displayName: "OMV", aliases: ["OMV"], websiteUrl: "https://www.omv.com" },
];
