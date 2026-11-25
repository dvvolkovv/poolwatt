// US-40 on the live build: the partner uploads a banner and a video, previews
// them, sends them to moderation; the Poolwatt operator decides; the point
// card shows what was approved and hides what is out of schedule.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_mkt_owner", password: "Pass1234" };
const ADMIN = { username: "e2e_mkt_admin", password: "Pass1234" };
const SLUG = "e2e-mkt-network";
const ZONE = "E2EMKT";

let operatorId: string;
let pointId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.marketingContent.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

/** A 1×1 PNG — enough bytes for the sniffer to call it a PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/** An MP4 that carries nothing but a five-second movie header. */
function mp4(durationMs: number): Buffer {
  const b = (type: string, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(payload.length + 8, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, payload]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(durationMs, 16);
  return Buffer.concat([
    b("ftyp", Buffer.from("isommp42", "latin1")),
    b("moov", b("mvhd", mvhd)),
  ]);
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: hash, role: "ADMIN" },
  });

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "E2E marketing zone", currency: "EUR" },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Marketing Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Marketing Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        addressLine: "Hlavná 2",
        latitude: 48.72,
        longitude: 21.26,
        gridZoneId: zone.id,
        open24: true,
        paymentMethods: ["TOKEN"],
        amenities: [],
        connectors: {
          create: [{ type: "CCS2", powerKw: new Prisma.Decimal(50), quantity: 1, status: "FREE" }],
        },
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, ADMIN.username] } } });
  await prisma.$disconnect();
});

test("a partner uploads a banner, previews it and sends it to moderation", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/marketing`);

  await expect(page.getByTestId("content-form")).toBeVisible();

  await page.getByLabel("Title", { exact: true }).fill("Half price on Sundays");
  await page.getByLabel("Files", { exact: true }).setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  // US-40 "предпросмотр" — the file is shown before it leaves the browser.
  await expect(page.getByTestId("content-preview")).toBeVisible();

  await page.getByRole("button", { name: "Save and submit for review" }).click();
  await expect(page.getByTestId("content-list")).toContainText("Half price on Sundays");
  await expect(page.getByTestId("content-list")).toContainText("In review");

  const stored = await prisma.marketingContent.findFirst({
    where: { operatorId, title: "Half price on Sundays" },
    include: { assets: true },
  });
  expect(stored?.status).toBe("REVIEW");
  expect(stored?.assets).toHaveLength(1);
  expect(stored?.assets[0].contentType).toBe("image/png");
});

test("a video over sixty seconds is refused, one under it is accepted", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/marketing`);

  await page.getByLabel("Type", { exact: true }).selectOption("VIDEO");
  await page.getByLabel("Title", { exact: true }).fill("Too long");
  await page.getByLabel("Files", { exact: true }).setInputFiles({
    name: "long.mp4",
    mimeType: "video/mp4",
    buffer: mp4(75_000),
  });
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByTestId("content-error")).toContainText(/60 s limit/i);
  expect(await prisma.marketingContent.count({ where: { operatorId, title: "Too long" } })).toBe(0);

  await page.getByLabel("Title", { exact: true }).fill("Short clip");
  await page.getByLabel("Files", { exact: true }).setInputFiles({
    name: "short.mp4",
    mimeType: "video/mp4",
    buffer: mp4(12_000),
  });
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByTestId("content-list")).toContainText("Short clip");

  const stored = await prisma.marketingContent.findFirst({
    where: { operatorId, title: "Short clip" },
    include: { assets: true },
  });
  expect(stored?.assets[0].durationMs).toBe(12_000);
});

test("the operator refuses with a reason, then approves, and the card shows it", async ({
  page,
}) => {
  const content = await prisma.marketingContent.findFirstOrThrow({
    where: { operatorId, title: "Half price on Sundays" },
  });

  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/marketing");
  await expect(page.getByTestId("admin-content-queue")).toContainText("Half price on Sundays");

  await page
    .getByLabel("Note for the partner")
    .first()
    .fill("Say what the price actually is");
  await page.getByTestId("reject-content").first().click();
  await expect
    .poll(async () =>
      (await prisma.marketingContent.findUnique({ where: { id: content.id } }))?.status,
    )
    .toBe("REJECTED");

  // The partner reads the reason on their own page — that is what makes a
  // refusal fixable rather than a dead end. A signed-in browser is bounced
  // off /login, so the session goes first.
  await page.context().clearCookies();
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/marketing`);
  await expect(page.getByTestId("review-note")).toContainText("Say what the price actually is");

  // Sent again and approved, it shows on the public point card.
  await prisma.marketingContent.update({
    where: { id: content.id },
    data: { status: "REVIEW", reviewNote: null },
  });
  await page.context().clearCookies();
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/marketing");
  await page.getByTestId("approve-content").first().click();
  await expect
    .poll(async () =>
      (await prisma.marketingContent.findUnique({ where: { id: content.id } }))?.status,
    )
    .toBe("APPROVED");

  await page.context().clearCookies();
  await page.goto(`/en/c/${pointId}`);
  await expect(page.getByTestId("marketing-section")).toBeVisible();
  await expect(page.getByTestId("marketing-section")).toContainText("From the network");
  await expect(page.getByTestId("marketing-banner")).toBeVisible();
});

test("content whose schedule has run out is not on the card, and its file is not served", async ({
  page,
  request,
}) => {
  const content = await prisma.marketingContent.findFirstOrThrow({
    where: { operatorId, title: "Half price on Sundays" },
    include: { assets: true },
  });
  const assetId = content.assets[0].id;

  // While it is live, anybody may fetch the picture: it is printed on a
  // public card.
  const live = await request.get(`/api/v1/marketing/media/${assetId}`);
  expect(live.status()).toBe(200);
  expect(live.headers()["content-type"]).toBe("image/png");

  await prisma.marketingContent.update({
    where: { id: content.id },
    data: { endsAt: new Date(Date.now() - 60_000) },
  });

  await page.context().clearCookies();
  await page.goto(`/en/c/${pointId}`);
  await expect(page.getByTestId("marketing-section")).toHaveCount(0);

  const expired = await request.get(`/api/v1/marketing/media/${assetId}`);
  expect(expired.status()).toBe(404);
});
