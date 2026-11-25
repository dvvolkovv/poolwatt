// US-45 and US-46 on the live build: the §46 receipt a driver opens and
// prints, the open page behind its QR code, and the month a partner's
// accountant downloads in five formats.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_rcpt_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_rcpt_driver", password: "Pass1234" };
const ACCOUNTANT = { username: "e2e_rcpt_acct", password: "Pass1234" };
const SLUG = "e2e-rcpt-network";
const ZONE = "E2ERCPT";

let operatorId: string;
let pointId: string;
let connectorId: string;
let driverUserId: string;
let receiptId: string;
let verifyCode: string;
let receiptNumber: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${SLUG}-reg` } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.operatorAccounting.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { regNumber: `${SLUG}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

/** The month the seeded charge falls into, as the page and the API name it. */
function monthOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CHARGE_AT = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 3, 10, 0, 0));
const MONTH = monthOf(CHARGE_AT);

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });
  driverUserId = (
    await prisma.user.upsert({
      where: { username: DRIVER.username },
      update: { passwordHash: hash },
      create: { username: DRIVER.username, passwordHash: hash },
    })
  ).id;
  await prisma.user.upsert({
    where: { username: ACCOUNTANT.username },
    update: { passwordHash: hash },
    create: { username: ACCOUNTANT.username, passwordHash: hash },
  });

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "E2E receipt zone", currency: "EUR" },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Receipt Network",
        logoUrl: "https://poolwatt.com/icon.svg",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Receipt Point",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 1",
      gridZoneId: zone.id,
      open24: true,
      paymentMethods: ["TOKEN"],
      amenities: [],
      connectors: {
        create: [{ type: "CCS2", powerKw: new Prisma.Decimal(150), quantity: 1, status: "FREE" }],
      },
      tariffs: {
        create: [
          {
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: new Prisma.Decimal(0.42),
            priceTokens: new Prisma.Decimal(1),
            currency: "EUR",
          },
        ],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0].id;

  // A company and a solar asset, so the receipt can name where the kWh came
  // from — §46 item 3 reads the batches, not the station's sign.
  const company = await prisma.company.create({
    data: {
      legalName: "E2E receipt producer",
      country: "SK",
      regNumber: `${SLUG}-reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      kind: "SOLAR",
      name: "E2E roof",
      capacityKw: new Prisma.Decimal(10),
      gridZoneId: zone.id,
      status: "ACTIVE",
    },
  });
  const wallet = await prisma.wallet.create({
    data: { ownerUserId: driverUserId, zoneId: zone.id, fiatBalance: new Prisma.Decimal(50) },
  });
  const token = await prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId: zone.id,
      intervalStart: CHARGE_AT,
      amountKwh: new Prisma.Decimal(10),
      status: "BURNED",
      burnedAt: CHARGE_AT,
    },
  });

  // §47 — the accountant the owner put on the books. The invite UI itself is
  // covered by staff-roles.spec.ts; here the point is what they may export.
  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "ACCOUNTANT",
      permissions: ["points.read", "finance.read"],
      builtIn: true,
    },
  });
  await prisma.employee.create({
    data: {
      operatorId,
      userId: (await prisma.user.findUniqueOrThrow({ where: { username: ACCOUNTANT.username } })).id,
      roleId: role.id,
      pointIds: [],
    },
  });

  const payment = await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId: zone.id,
      pointId,
      connectorId,
      startedAt: new Date(CHARGE_AT.getTime() - 30 * 60_000),
      endedAt: CHARGE_AT,
      requestedKwh: new Prisma.Decimal(10),
      kwhFromBalance: new Prisma.Decimal(10),
      amountFiat: new Prisma.Decimal(4.2),
      status: "CAPTURED",
      capturedAt: CHARGE_AT,
    },
  });

  // The number and the code are what the payment path mints; here the row is
  // seeded directly, so they are minted the same way.
  const seq = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('receipt_number_seq')`;
  receiptNumber = `PW-${CHARGE_AT.getUTCFullYear()}-${String(Number(seq[0].nextval)).padStart(6, "0")}`;
  verifyCode = [...Array(32)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  receiptId = (
    await prisma.receipt.create({
      data: {
        number: receiptNumber,
        verifyCode,
        paymentId: payment.id,
        burnedTokenIds: [token.id],
        totalKwh: new Prisma.Decimal(10),
        totalFiat: new Prisma.Decimal(4.2),
        currency: "EUR",
        issuedAt: CHARGE_AT,
        // Delivered already: the e2e run must not mail anybody.
        deliveredAt: new Date(),
        deliveryChannels: ["wallet"],
        breakdown: {
          kind: "charge",
          kwhFromBalance: 10,
          kwhBought: 0,
          energyCost: 4.2,
          reservationFee: 0.5,
          reservationCredit: 0.5,
        },
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, DRIVER.username, ACCOUNTANT.username] } },
  });
  await prisma.$disconnect();
});

test("the network fills in its requisites and the VAT rate (§46, US-46)", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/accounting`);

  const form = page.getByTestId("requisites-form");
  await expect(form).toBeVisible();
  await form.locator('input[name="legalName"]').fill("E2E Receipt s.r.o.");
  await form.locator('input[name="regNumber"]').fill("12345678");
  await form.locator('input[name="vatNumber"]').fill("SK2020123456");
  await form.locator('input[name="addressLine"]').fill("Hlavná 1");
  await form.locator('input[name="city"]').fill("Košice");
  await form.locator('input[name="country"]').fill("SK");
  await form.locator('input[name="vatRatePct"]').fill("20");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toContainText("Saved");

  const saved = await prisma.operatorAccounting.findUniqueOrThrow({ where: { operatorId } });
  expect(saved.legalName).toBe("E2E Receipt s.r.o.");
  expect(Number(saved.vatRatePct)).toBe(20);
});

test("the driver opens the receipt and sees every part of §46", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/me/wallet/receipts/${receiptId}`);

  const sheet = page.getByTestId("receipt");
  await expect(sheet).toBeVisible();
  // §46.1 — Poolwatt, then the network in its own design.
  await expect(sheet).toContainText("POOLWATT");
  await expect(sheet).toContainText("E2E Receipt Network");
  await expect(sheet).toContainText("E2E Receipt s.r.o.");
  await expect(sheet).toContainText("SK2020123456");
  await expect(sheet.locator("img")).toHaveAttribute("src", "https://poolwatt.com/icon.svg");
  // §46.2 — point, connector, window.
  await expect(sheet).toContainText("E2E Receipt Point");
  await expect(sheet).toContainText("CCS2");
  // §46.3–4 — volume, source, both prices.
  await expect(sheet).toContainText("10.000 kWh");
  await expect(sheet).toContainText("solar");
  await expect(sheet).toContainText("0.4200 EUR/kWh");
  await expect(sheet).toContainText("1.000 tok/kWh");
  // §46.4 tail — the booking fee and its credit.
  await expect(sheet).toContainText("0.50 EUR");
  // §46.5 — what paid for it.
  await expect(sheet).toContainText("From the kWh balance");
  // §46.7 — VAT extracted at the network's rate.
  await expect(sheet).toContainText("VAT 20.00 %");
  await expect(sheet).toContainText("4.20 EUR");
  // §46.8 — the QR code, drawn on the server.
  await expect(sheet.locator("svg")).toBeVisible();
  await expect(sheet).toContainText(`/r/${verifyCode}`);
  await expect(sheet).toContainText(receiptNumber);
});

test("the receipt prints from a station terminal", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  // auto=0 keeps the print dialog closed; the page is what is under test.
  await page.goto(`/en/me/wallet/receipts/${receiptId}/print?auto=0`);
  await expect(page.getByTestId("receipt-print")).toBeVisible();
  await expect(page.getByTestId("receipt")).toContainText("E2E Receipt Point");
});

test("somebody else's receipt does not exist", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  const response = await page.goto(`/en/me/wallet/receipts/${receiptId}`);
  expect(response?.status()).toBe(404);
});

test("the QR code leads to an open page that proves the receipt", async ({ page }) => {
  // No sign-in on purpose: whoever holds the paper can check it.
  await page.goto(`/en/r/${verifyCode}`);
  await expect(page.getByTestId("verify-ok")).toBeVisible();
  const proof = page.getByTestId("verify-proof");
  await expect(proof).toContainText(receiptNumber);
  await expect(proof).toContainText("E2E Receipt Point");
  await expect(proof).toContainText("10.000 kWh");
  await expect(proof).toContainText("4.20 EUR");
  // And nothing about who charged.
  await expect(proof).not.toContainText(DRIVER.username);

  const missing = await page.goto(`/en/r/${"f".repeat(32)}`);
  expect(missing?.status()).toBe(404);
});

test("the accountant exports the month in every format (US-46)", async ({ page, request }) => {
  await signInWithPassword(page, ACCOUNTANT);
  await page.goto(`/en/me/charger-operator/${operatorId}/accounting?month=${MONTH}`);

  // The month's lines, and the totals the five files have to agree with.
  const table = page.getByTestId("ledger-table");
  await expect(table).toContainText(receiptNumber);
  await expect(table).toContainText("E2E Receipt Point");
  await expect(table).toContainText("4.20");

  // An accountant is not the owner: the requisites form is not theirs to edit.
  await expect(page.getByTestId("requisites-form")).toHaveCount(0);

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const base = `/api/v1/charger-operators/${operatorId}/accounting/export?month=${MONTH}`;

  const csv = await request.get(`${base}&format=csv`, { headers: { cookie: cookieHeader } });
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain(".csv");
  const csvText = await csv.text();
  expect(csvText).toContain(receiptNumber);
  expect(csvText).toContain("4,20");

  const xlsx = await request.get(`${base}&format=xlsx`, { headers: { cookie: cookieHeader } });
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString("latin1")).toBe("PK");

  const pdf = await request.get(`${base}&format=pdf`, { headers: { cookie: cookieHeader } });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // DATEV and BMD refuse until the partner supplies account numbers, and say so.
  const datevClosed = await request.get(`${base}&format=datev`, { headers: { cookie: cookieHeader } });
  expect(datevClosed.status()).toBe(409);
  expect(await datevClosed.text()).toMatch(/account/i);

  await prisma.operatorAccounting.update({
    where: { operatorId },
    data: {
      datevConsultantNo: "1234567",
      datevClientNo: "77001",
      revenueAccount: "8400",
      counterAccount: "10000",
      bmdClientNo: "5001",
    },
  });

  const datev = await request.get(`${base}&format=datev`, { headers: { cookie: cookieHeader } });
  expect(datev.status()).toBe(200);
  const datevText = await datev.text();
  expect(datevText).toContain('"EXTF";700;21;"Buchungsstapel"');
  expect(datevText).toContain("8400");
  expect(datevText).toContain(receiptNumber);

  const bmd = await request.get(`${base}&format=bmd`, { headers: { cookie: cookieHeader } });
  expect(bmd.status()).toBe(200);
  expect(await bmd.text()).toContain("Satzart");
});

test("a stranger gets nothing from the books", async ({ page, request }) => {
  await signInWithPassword(page, DRIVER);
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const response = await request.get(
    `/api/v1/charger-operators/${operatorId}/accounting/export?month=${MONTH}&format=csv`,
    { headers: { cookie: cookieHeader } },
  );
  expect(response.status()).toBe(404);

  const pageResponse = await page.goto(`/en/me/charger-operator/${operatorId}/accounting`);
  expect(pageResponse?.status()).toBe(404);
});
