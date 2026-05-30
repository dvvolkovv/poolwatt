import { z } from "zod";

const entityTypeEnum = z.enum(["LEGAL_ENTITY", "SOLE_TRADER", "INDIVIDUAL"]);
const workCategoryEnum = z.enum([
  "DESIGN", "MANUFACTURE", "SUPPLY", "INSTALLATION", "COMMISSIONING", "MAINTENANCE",
]);
const renewableTypeEnum = z.enum([
  "SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID",
]);

const isoCountry = z.string().regex(/^[A-Z]{2}$/, "Must be ISO-2 uppercase");

const httpUrl = z
  .string()
  .max(500)
  .refine(
    (s) => {
      try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    "Must be a valid http(s) URL",
  );

export const contractorSchema = z
  .object({
    entityType: entityTypeEnum,
    displayName: z.string().min(2).max(100),
    legalName: z.string().min(2).max(200).optional(),
    registrationNumber: z.string().min(4).max(40).optional(),
    country: isoCountry,
    city: z.string().min(1).max(80),
    foundedYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),

    workCategories: z.array(workCategoryEnum).min(1),
    renewableTypes: z.array(renewableTypeEnum).min(1),
    countriesServed: z.array(isoCountry).min(1),

    bio: z.string().min(100).max(2000),
    websiteUrl: httpUrl.optional(),
    logoUrl: httpUrl.optional(),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
  })
  .superRefine((data, ctx) => {
    if (data.entityType === "LEGAL_ENTITY" && !data.legalName) {
      ctx.addIssue({
        code: "custom",
        path: ["legalName"],
        message: "legalName required for LEGAL_ENTITY",
      });
    }
    if (data.entityType !== "INDIVIDUAL" && !data.registrationNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationNumber"],
        message: "registrationNumber required for LEGAL_ENTITY and SOLE_TRADER",
      });
    }
    if (new Set(data.workCategories).size !== data.workCategories.length) {
      ctx.addIssue({ code: "custom", path: ["workCategories"], message: "no duplicates allowed" });
    }
    if (new Set(data.renewableTypes).size !== data.renewableTypes.length) {
      ctx.addIssue({ code: "custom", path: ["renewableTypes"], message: "no duplicates allowed" });
    }
    if (new Set(data.countriesServed).size !== data.countriesServed.length) {
      ctx.addIssue({ code: "custom", path: ["countriesServed"], message: "no duplicates allowed" });
    }
  });

export type ContractorInput = z.infer<typeof contractorSchema>;
