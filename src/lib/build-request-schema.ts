import { z } from "zod";

const sourceEnum = z.enum(["SOLAR", "WIND", "HYBRID"]);
const siteTypeEnum = z.enum(["PRIVATE_HOUSE", "APARTMENT_ROOF", "LAND_PLOT", "COMMERCIAL"]);
const roofOrientationEnum = z.enum(["S", "SE", "SW", "E", "W", "UNKNOWN"]);
const budgetEnum = z.enum([
  "UNDER_5K", "FROM_5K_TO_15K", "FROM_15K_TO_30K", "FROM_30K_TO_60K",
  "OVER_60K", "AWAITING_QUOTE",
]);
const timelineEnum = z.enum(["URGENT_1_3M", "WITHIN_YEAR", "EXPLORING"]);

export const buildRequestSchema = z
  .object({
    source: sourceEnum,
    peakKw: z.number().min(0.5).max(500),
    wantPowerbank: z.boolean(),
    powerbankKwh: z.number().min(1).max(500).optional(),
    wantEvCharger: z.boolean(),
    evChargerPorts: z.number().int().min(1).max(10).optional(),
    evPublicForSale: z.boolean(),

    country: z.string().regex(/^[A-Z]{2}$/, "Country must be ISO-2 uppercase"),
    city: z.string().min(1).max(80),
    addressLine: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    siteType: siteTypeEnum,
    availableAreaM2: z.number().int().min(0).max(100_000).optional(),
    roofOrientation: roofOrientationEnum.optional(),

    budget: budgetEnum,
    timeline: timelineEnum,
    notes: z.string().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.wantPowerbank && data.powerbankKwh == null) {
      ctx.addIssue({
        code: "custom",
        path: ["powerbankKwh"],
        message: "powerbankKwh is required when wantPowerbank is true",
      });
    }
    if (data.wantEvCharger && data.evChargerPorts == null) {
      ctx.addIssue({
        code: "custom",
        path: ["evChargerPorts"],
        message: "evChargerPorts is required when wantEvCharger is true",
      });
    }
    if (data.evPublicForSale && !data.wantEvCharger) {
      ctx.addIssue({
        code: "custom",
        path: ["evPublicForSale"],
        message: "evPublicForSale requires wantEvCharger",
      });
    }
    if ((data.source === "SOLAR" || data.source === "HYBRID") && data.roofOrientation == null) {
      ctx.addIssue({
        code: "custom",
        path: ["roofOrientation"],
        message: "roofOrientation is required for SOLAR/HYBRID",
      });
    }
  });

export type BuildRequestInput = z.infer<typeof buildRequestSchema>;
