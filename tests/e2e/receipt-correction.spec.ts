// §46 on the live build: the accountant returns a wrong document to support,
// support issues a corrected version by the regulation, and both documents —
// plus the journal of what moved — are readable afterwards. A claim about the
// amounts is refused, because a refund needs the payment provider.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_rc_owner", password: "Pass1234" };
const ACC = { username: "e2e_rc_acc", password: "Pass1234" };
const ADMIN = { username: "e2e_rc_admin", password: "Pass1234" };
const SLUG = "e2e-receipt-correction";
const ZONE = "E2ERCORR";

let operatorId: string;
let zoneId: string;
let pointId: string;
let ownerUserId: string;
let accUserId: string;
let receiptId: string;
let receiptNumber: string | null;
let month: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receiptCorrection.deleteMany({
    where: { receipt: { payment: { zone: { code: ZONE } } } },
  });
  await prisma.receiptClaim.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.receipt.deleteMany({ where: { corrects: { payment: { zone: { code: ZONE } } } } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.operatorAccounting.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const user = async (username: string, role: "USER" | "ADMIN" = "USER") =>
    (
      await prisma.user.upsert({
        where: { username },
        update: { passwordHash: hash, role },
        create: { username, passwordHash: hash, role },
      })
    ).id;
  ownerUserId = await user(OWNER.username);
  accUserId = await user(ACC.username);
  await user(ADMIN.username, "ADMIN");

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E correction zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Correction Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  await prisma.operatorAccounting.create({
    data: {
      operatorId,
      legalName: "E2E Correction s.r.o.",
      regNumber: "11112222",
      vatNumber: "SK0000000000",
      addressLine: "Hlavná 7",
      city: "Košice",
      country: "SK",
      vatRatePct: new Prisma.Decimal(20),
    },
  });
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Correction Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        gridZoneId: zoneId,
      },
    })
  ).id;

  // §47 — the accountant who keeps this network's books.
  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "ACCOUNTANT",
      permissions: ["points.read", "finance.read"],
      builtIn: true,
    },
  });
  await prisma.employee.create({
    data: { operatorId, userId: accUserId, roleId: role.id, pointIds: [] },
  });

  // A charge of this month, so the accountant's page shows it by default.
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 10, 0, 0));
  month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;

  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: ownerUserId, zoneId } },
    update: {},
    create: { ownerUserId: ownerUserId, zoneId },
  });
  const payment = await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId,
      pointId,
      startedAt: at,
      endedAt: at,
      requestedKwh: new Prisma.Decimal(12),
      kwhFromBalance: new Prisma.Decimal(12),
      amountFiat: new Prisma.Decimal(4.8),
      status: "CAPTURED",
      capturedAt: at,
    },
  });
  const receipt = await prisma.receipt.create({
    data: {
      number: `PW-E2E-${Date.now().toString().slice(-6)}`,
      verifyCode: Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
      paymentId: payment.id,
      burnedTokenIds: [],
      totalKwh: new Prisma.Decimal(12),
      totalFiat: new Prisma.Decimal(4.8),
      currency: "EUR",
      issuedAt: at,
      breakdown: { kind: "charge", kwhFromBalance: 12 } as Prisma.InputJsonValue,
    },
  });
  receiptId = receipt.id;
  receiptNumber = receipt.number;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, ACC.username, ADMIN.username] } },
  });
  await prisma.$disconnect();
});

test("the accountant returns a wrong document to support", async ({ page }) => {
  await signInWithPassword(page, ACC);
  await page.goto(`/en/me/charger-operator/${operatorId}/accounting?month=${month}`);

  await expect(page.getByTestId("ledger-table")).toContainText(receiptNumber!);

  await page.getByTestId("return-receipt").first().click();
  await page.getByTestId("claim-reason").selectOption("VAT");
  await page.getByTestId("claim-comment").fill("Our VAT number changed in January, this is the old one");
  await page.getByTestId("claim-send").click();

  // The page revalidates, so the row itself says the document is with
  // support — the message in the form is gone with the re-render.
  await expect(page.getByTestId("claim-open")).toBeVisible();

  const claim = await prisma.receiptClaim.findFirstOrThrow({ where: { receiptId } });
  expect(claim.status).toBe("OPEN");
  expect(claim.claimedById).toBe(accUserId);
});

test("support issues a corrected version, and the journal says what moved", async ({ page }) => {
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/receipt-claims");

  const card = page.getByTestId("claim-card").filter({ hasText: receiptNumber! });
  await expect(card).toContainText("Our VAT number changed");

  await card.getByTestId("claim-field-network.vatNumber").fill("SK1234567890");
  await card.getByTestId("claim-note").fill("New VAT number from the register, valid since January");
  await card.getByTestId("claim-correct").click();
  // The page revalidates, so the answered claim re-renders without the form:
  // the proof is the new state of the card, not a message in it.
  await expect(card).toContainText("Corrected");
  await expect(card.getByTestId("claim-journal")).toContainText("SK1234567890");

  const correction = await prisma.receiptCorrection.findFirstOrThrow({
    where: { receiptId },
    include: { issuedReceipt: true },
  });
  expect(correction.issuedReceipt.correctsReceiptId).toBe(receiptId);
  expect(Number(correction.issuedReceipt.totalFiat)).toBe(4.8);
  expect(correction.changes).toEqual([
    { field: "network.vatNumber", before: "SK0000000000", after: "SK1234567890" },
  ]);

  // Both documents say which version they are, and carry the journal.
  await page.goto(`/en/me/wallet/receipts/${receiptId}`);
  await expect(page.getByTestId("receipt-corrected-by")).toContainText(
    correction.issuedReceipt.number!,
  );
  await expect(page.getByTestId("receipt-journal")).toContainText("SK1234567890");

  await page.goto(`/en/me/wallet/receipts/${correction.issuedReceiptId}`);
  await expect(page.getByTestId("receipt-corrects")).toContainText(receiptNumber!);
  // The corrected document carries the new number, the old one still its own.
  await expect(page.getByTestId("receipt")).toContainText("SK1234567890");
});

test("the month now prints the document in force", async ({ page }) => {
  const correction = await prisma.receiptCorrection.findFirstOrThrow({
    where: { receiptId },
    include: { issuedReceipt: true },
  });

  await signInWithPassword(page, ACC);
  await page.goto(`/en/me/charger-operator/${operatorId}/accounting?month=${month}`);

  const table = page.getByTestId("ledger-table");
  await expect(table).toContainText(correction.issuedReceipt.number!);
  await expect(page.getByTestId("line-corrected").first()).toBeVisible();
  // One sale, one line: the correction did not double the month.
  await expect(table.locator("tbody tr")).toHaveCount(1);

  // The answer is on the accountant's own page too.
  await expect(page.getByTestId("operator-claims")).toContainText("New VAT number from the register");
});

test("a claim about the amounts is refused, and says why", async ({ page }) => {
  // Every test gets its own browser context, so each one signs in for itself.
  await signInWithPassword(page, ACC);
  await page.goto(`/en/me/charger-operator/${operatorId}/accounting?month=${month}`);
  await page.getByTestId("return-receipt").first().click();
  await page.getByTestId("claim-reason").selectOption("AMOUNTS");
  await page.getByTestId("claim-comment").fill("The driver says this session cost less than printed");
  await page.getByTestId("claim-send").click();
  await expect(page.getByTestId("claim-open")).toBeVisible();

  // Changing who you are means dropping the session first: the login page
  // sends an already signed-in visitor to their cabinet.
  await page.context().clearCookies();
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/receipt-claims");
  const card = page
    .getByTestId("claim-card")
    .filter({ hasText: "The driver says this session cost less" });

  await card.getByTestId("claim-field-network.legalName").fill("Any other name a.s.");
  await card.getByTestId("claim-correct").click();
  await expect(card.getByTestId("claim-error")).toContainText("payment provider");

  // So support answers in words instead.
  await card
    .getByTestId("claim-reject-reason")
    .fill("A refund needs the payment provider; the document itself is right");
  await card.getByTestId("claim-reject").click();
  await expect(card).toContainText("Refused");

  const claim = await prisma.receiptClaim.findFirstOrThrow({
    where: { receiptId, reason: "AMOUNTS" },
  });
  expect(claim.status).toBe("REJECTED");
});
