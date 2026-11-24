// Server actions behind the producer's listing pages — ТЗ §12 US-01.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUser: { id: string; username: string; role: "USER" | "ADMIN" } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUser ? { user: mockUser } : null)),
}));
const sentToAdmin = vi.fn(async () => {});
vi.mock("@/lib/resend-listing", () => ({
  sendListingSubmittedToAdmin: (...args: unknown[]) => sentToAdmin(...(args as [])),
  sendListingDecisionToOwner: vi.fn(async () => {}),
}));

import { registerCompany, sendApplication, uploadDocument, dropDocument } from "./actions";

const PREFIX = "test_listact_";
const PDF = Buffer.from("%PDF-1.7\npaper\n");
let docsDir: string;
let ownerId: string;
let strangerId: string;

const pdfFile = (name = "licence.pdf") =>
  new File([new Uint8Array(PDF)], name, { type: "application/pdf" });

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  docsDir = mkdtempSync(join(tmpdir(), "listing-actions-"));
  process.env.LISTING_DOCS_DIR = docsDir;
  await cleanup();
  ownerId = (await prisma.user.create({
    data: { username: PREFIX + "owner", passwordHash: "x" },
  })).id;
  strangerId = (await prisma.user.create({
    data: { username: PREFIX + "stranger", passwordHash: "x" },
  })).id;
});

afterAll(async () => {
  await cleanup();
  rmSync(docsDir, { recursive: true, force: true });
  delete process.env.LISTING_DOCS_DIR;
});

let seq = 0;
beforeEach(async () => {
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  mockUser = { id: ownerId, username: PREFIX + "owner", role: "USER" };
  sentToAdmin.mockClear();
});

const register = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return registerCompany({
    legalName: `${PREFIX}Co ${seq}`,
    country: "SK",
    regNumber: `${PREFIX}reg${seq}`,
    type: "PRODUCER",
    contactEmail: "listing@example.com",
    ...over,
  });
};

async function companyWithDraft() {
  const created = await register();
  if (!created.ok) throw new Error(created.formError);
  return created;
}

describe("registerCompany", () => {
  it("needs a signed-in user", async () => {
    mockUser = null;
    expect((await register()).ok).toBe(false);
  });

  it("creates the company with a draft application to upload into", async () => {
    const result = await companyWithDraft();
    expect(result.applicationId).toBeTruthy();
    const app = await prisma.listingApplication.findUniqueOrThrow({
      where: { id: result.applicationId! },
    });
    expect(app.status).toBe("DRAFT");
  });

  it("reports the field, not a stack trace, on bad input", async () => {
    const bad = await register({ country: "Slovakia", regNumber: "" });
    expect(bad.ok).toBe(false);
    expect(bad.fieldErrors?.country || bad.fieldErrors?.regNumber).toBeTruthy();
  });

  it("refuses a duplicate registration number in the same country", async () => {
    const first = await companyWithDraft();
    const company = await prisma.company.findUniqueOrThrow({ where: { id: first.companyId! } });
    const again = await register({ country: company.country, regNumber: company.regNumber });
    expect(again.ok).toBe(false);
    expect(again.formError).toMatch(/already/i);
  });
});

describe("uploadDocument / dropDocument — US-01", () => {
  it("accepts a PDF and lists it on the application", async () => {
    const { companyId } = await companyWithDraft();
    const result = await uploadDocument(companyId!, pdfFile());
    expect(result.ok).toBe(true);
    expect(result.documents).toHaveLength(1);
    expect(result.documents?.[0].name).toBe("licence.pdf");
  });

  it("refuses a file that is not a PDF or image whatever its name says", async () => {
    const { companyId } = await companyWithDraft();
    const fake = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "licence.pdf", {
      type: "application/pdf",
    });
    const result = await uploadDocument(companyId!, fake);
    expect(result.ok).toBe(false);
    expect(result.formError).toMatch(/PDF/i);
  });

  it("refuses an upload to someone else's company", async () => {
    const { companyId } = await companyWithDraft();
    mockUser = { id: strangerId, username: PREFIX + "stranger", role: "USER" };
    const result = await uploadDocument(companyId!, pdfFile());
    expect(result.ok).toBe(false);
  });

  it("takes a document back out of the draft", async () => {
    const { companyId } = await companyWithDraft();
    const added = await uploadDocument(companyId!, pdfFile());
    const docId = added.documents![0].docId!;
    const after = await dropDocument(companyId!, docId);
    expect(after.ok).toBe(true);
    expect(after.documents).toEqual([]);
  });
});

describe("sendApplication — US-01", () => {
  it("moves the draft to review and notifies the operator", async () => {
    const { companyId, applicationId } = await companyWithDraft();
    await uploadDocument(companyId!, pdfFile());

    const result = await sendApplication(companyId!);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("SUBMITTED");
    const app = await prisma.listingApplication.findUniqueOrThrow({
      where: { id: applicationId! },
    });
    expect(app.status).toBe("SUBMITTED");
    expect(app.submittedAt).toBeInstanceOf(Date);
    expect(sentToAdmin).toHaveBeenCalledTimes(1);
  });

  it("will not send an application with no documents", async () => {
    const { companyId } = await companyWithDraft();
    const result = await sendApplication(companyId!);
    expect(result.ok).toBe(false);
    expect(sentToAdmin).not.toHaveBeenCalled();
  });

  it("refuses to send someone else's application", async () => {
    const { companyId } = await companyWithDraft();
    await uploadDocument(companyId!, pdfFile());
    mockUser = { id: strangerId, username: PREFIX + "stranger", role: "USER" };
    const result = await sendApplication(companyId!);
    expect(result.ok).toBe(false);
    expect(sentToAdmin).not.toHaveBeenCalled();
  });
});
