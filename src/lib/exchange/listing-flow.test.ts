// The path a producer walks through the site — ТЗ §4, §14, US-01, US-02.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  ListingError,
  addDocument,
  createCompany,
  decideApplication,
  draftApplicationFor,
  fetchDocument,
  removeDocument,
  submitApplication,
} from "./listing-service";
import { readDocument } from "./listing-docs";

const PREFIX = "test_listflow_";
const PDF = Buffer.from("%PDF-1.7\nhello\n");

let docsDir: string;
let ownerId: string;
let operatorId: string;

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  docsDir = mkdtempSync(join(tmpdir(), "listing-flow-"));
  process.env.LISTING_DOCS_DIR = docsDir;
  await cleanup();
  const owner = await prisma.user.create({
    data: { username: PREFIX + "owner", passwordHash: "x" },
  });
  const operator = await prisma.user.create({
    data: { username: PREFIX + "op", passwordHash: "x", role: "ADMIN" },
  });
  ownerId = owner.id;
  operatorId = operator.id;
});

afterAll(async () => {
  await cleanup();
  rmSync(docsDir, { recursive: true, force: true });
  delete process.env.LISTING_DOCS_DIR;
});

beforeEach(async () => {
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
});

let seq = 0;
const makeCompany = () =>
  createCompany({
    legalName: `${PREFIX}co${++seq}`,
    country: "sk",
    regNumber: `${PREFIX}reg${seq}`,
    type: "PRODUCER",
    ownerUserId: ownerId,
  });

describe("createCompany — §14 черновик", () => {
  it("opens a draft application so documents have somewhere to go", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);

    expect(draft.status).toBe("DRAFT");
    expect(draft.companyId).toBe(company.id);
    expect(draft.documents).toEqual([]);
    expect(company.country).toBe("SK");
  });

  it("returns the same draft on a second call instead of a second row", async () => {
    const company = await makeCompany();
    const a = await draftApplicationFor(company.id);
    const b = await draftApplicationFor(company.id);
    expect(b.id).toBe(a.id);
    expect(await prisma.listingApplication.count({ where: { companyId: company.id } })).toBe(1);
  });
});

describe("addDocument / removeDocument — US-01", () => {
  it("appends an uploaded file to the draft and keeps the bytes readable", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);

    const { application, document } = await addDocument({
      applicationId: draft.id,
      filename: "licence.pdf",
      bytes: PDF,
      actorUserId: ownerId,
    });

    expect(application.documents).toHaveLength(1);
    expect(document.mime).toBe("application/pdf");
    const back = await readDocument(draft.id, document.docId);
    expect(back?.bytes.equals(PDF)).toBe(true);
  });

  it("drops the file from disk when the producer removes it", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    const { document } = await addDocument({
      applicationId: draft.id,
      filename: "licence.pdf",
      bytes: PDF,
      actorUserId: ownerId,
    });

    const after = await removeDocument({
      applicationId: draft.id,
      docId: document.docId,
      actorUserId: ownerId,
    });

    expect(after.documents).toEqual([]);
    expect(await readDocument(draft.id, document.docId)).toBeNull();
  });

  it("refuses to change the papers of an application already under review", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    await addDocument({
      applicationId: draft.id,
      filename: "licence.pdf",
      bytes: PDF,
      actorUserId: ownerId,
    });
    await submitApplication({ companyId: company.id, actorUserId: ownerId });

    await expect(
      addDocument({
        applicationId: draft.id,
        filename: "second.pdf",
        bytes: PDF,
        actorUserId: ownerId,
      }),
    ).rejects.toThrow(ListingError);
    await expect(
      removeDocument({ applicationId: draft.id, docId: "whatever", actorUserId: ownerId }),
    ).rejects.toThrow(ListingError);
  });
});

describe("submitApplication from the draft — US-01", () => {
  it("moves the draft to SUBMITTED with its own documents", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    await addDocument({
      applicationId: draft.id,
      filename: "licence.pdf",
      bytes: PDF,
      actorUserId: ownerId,
    });

    const submitted = await submitApplication({ companyId: company.id, actorUserId: ownerId });

    expect(submitted.id).toBe(draft.id);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    expect(submitted.documents).toHaveLength(1);
  });

  it("will not send an application with no papers at all", async () => {
    const company = await makeCompany();
    await draftApplicationFor(company.id);
    await expect(
      submitApplication({ companyId: company.id, actorUserId: ownerId }),
    ).rejects.toThrow(ListingError);
  });

  it("reopens a draft after a rejection so the producer can try again", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    await addDocument({
      applicationId: draft.id, filename: "a.pdf", bytes: PDF, actorUserId: ownerId,
    });
    await submitApplication({ companyId: company.id, actorUserId: ownerId });
    await decideApplication({
      applicationId: draft.id,
      reviewerId: operatorId,
      approve: false,
      comment: "Лицензия просрочена",
    });

    const reopened = await draftApplicationFor(company.id);
    expect(reopened.id).not.toBe(draft.id);
    expect(reopened.status).toBe("DRAFT");
    // The rejection stays on the record the operator decided.
    const rejected = await prisma.listingApplication.findUniqueOrThrow({ where: { id: draft.id } });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionComment).toBe("Лицензия просрочена");
  });
});

describe("fetchDocument — US-01/US-02 access control", () => {
  it("serves the file to the company owner and to an operator, nobody else", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    const { document } = await addDocument({
      applicationId: draft.id, filename: "licence.pdf", bytes: PDF, actorUserId: ownerId,
    });
    const stranger = await prisma.user.create({
      data: { username: PREFIX + "stranger" + seq, passwordHash: "x" },
    });

    const asOwner = await fetchDocument({
      applicationId: draft.id, docId: document.docId,
      user: { id: ownerId, role: "USER" },
    });
    expect(asOwner.status).toBe("ok");
    if (asOwner.status === "ok") {
      expect(asOwner.bytes.equals(PDF)).toBe(true);
      expect(asOwner.name).toBe("licence.pdf");
      expect(asOwner.mime).toBe("application/pdf");
    }

    const asOperator = await fetchDocument({
      applicationId: draft.id, docId: document.docId,
      user: { id: operatorId, role: "ADMIN" },
    });
    expect(asOperator.status).toBe("ok");

    const asStranger = await fetchDocument({
      applicationId: draft.id, docId: document.docId,
      user: { id: stranger.id, role: "USER" },
    });
    expect(asStranger.status).toBe("forbidden");
  });

  it("is a 404 for an id that is not on this application", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    await addDocument({
      applicationId: draft.id, filename: "a.pdf", bytes: PDF, actorUserId: ownerId,
    });

    expect(
      (await fetchDocument({
        applicationId: draft.id, docId: "deadbeefdeadbeefdeadbeef",
        user: { id: ownerId, role: "USER" },
      })).status,
    ).toBe("not-found");
    expect(
      (await fetchDocument({
        applicationId: "nosuchapplication", docId: "deadbeef",
        user: { id: ownerId, role: "USER" },
      })).status,
    ).toBe("not-found");
  });

  it("refuses an anonymous reader", async () => {
    const company = await makeCompany();
    const draft = await draftApplicationFor(company.id);
    const { document } = await addDocument({
      applicationId: draft.id, filename: "a.pdf", bytes: PDF, actorUserId: ownerId,
    });
    expect(
      (await fetchDocument({ applicationId: draft.id, docId: document.docId, user: null })).status,
    ).toBe("unauthorized");
  });
});
