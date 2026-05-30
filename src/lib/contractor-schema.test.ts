import { describe, it, expect } from "vitest";
import { contractorSchema } from "./contractor-schema";

const baseLegal = {
  entityType: "LEGAL_ENTITY" as const,
  displayName: "SolarCo s.r.o.",
  legalName: "SolarCo Renewable Energy s.r.o.",
  registrationNumber: "12345678",
  country: "SK",
  city: "Bratislava",
  foundedYear: 2015,
  workCategories: ["DESIGN", "INSTALLATION"],
  renewableTypes: ["SOLAR"],
  countriesServed: ["SK", "CZ"],
  bio: "x".repeat(150),
  contactEmail: "info@solarco.sk",
  contactPhone: "+421900000001",
};

const baseIndividual = {
  ...baseLegal,
  entityType: "INDIVIDUAL" as const,
  legalName: undefined,
  registrationNumber: undefined,
};

describe("contractorSchema", () => {
  it("accepts a valid LEGAL_ENTITY contractor", () => {
    expect(contractorSchema.safeParse(baseLegal).success).toBe(true);
  });

  it("requires legalName when entityType=LEGAL_ENTITY", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, legalName: undefined });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "legalName")).toBe(true);
  });

  it("requires registrationNumber for LEGAL_ENTITY and SOLE_TRADER", () => {
    const r1 = contractorSchema.safeParse({ ...baseLegal, registrationNumber: undefined });
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.error.issues.some(i => i.path[0] === "registrationNumber")).toBe(true);

    const r2 = contractorSchema.safeParse({
      ...baseLegal,
      entityType: "SOLE_TRADER",
      legalName: undefined,
      registrationNumber: undefined,
    });
    expect(r2.success).toBe(false);
    if (!r2.success) expect(r2.error.issues.some(i => i.path[0] === "registrationNumber")).toBe(true);
  });

  it("allows INDIVIDUAL without legalName or registrationNumber", () => {
    expect(contractorSchema.safeParse(baseIndividual).success).toBe(true);
  });

  it("requires at least one workCategory", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, workCategories: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "workCategories")).toBe(true);
  });

  it("requires at least one renewableType", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, renewableTypes: [] });
    expect(r.success).toBe(false);
  });

  it("requires at least one countriesServed entry", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, countriesServed: [] });
    expect(r.success).toBe(false);
  });

  it("rejects bio shorter than 100 chars", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, bio: "short" });
    expect(r.success).toBe(false);
  });

  it("rejects bio longer than 2000 chars", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, bio: "x".repeat(2001) });
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO-2 country", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, country: "slo" });
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO-2 entries in countriesServed", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, countriesServed: ["SK", "slovakia"] });
    expect(r.success).toBe(false);
  });

  it("rejects invalid contactPhone (not E.164)", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, contactPhone: "0900000001" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid contactEmail", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, contactEmail: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid websiteUrl scheme", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, websiteUrl: "javascript:alert(1)" });
    expect(r.success).toBe(false);
  });

  it("accepts valid http(s) websiteUrl and logoUrl", () => {
    const r = contractorSchema.safeParse({
      ...baseLegal,
      websiteUrl: "https://solarco.sk",
      logoUrl: "https://cdn.solarco.sk/logo.png",
    });
    expect(r.success).toBe(true);
  });
});
