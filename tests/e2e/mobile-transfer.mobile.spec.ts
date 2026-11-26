// M4 — экран «Контакты и переводы» и биометрия на телефоне.
//
// Подпись WebAuthn ставит виртуальный аутентификатор Chrome: настоящий
// отпечаток в тесте не нажмёшь, а проверяет подпись наш сервер, и проверяется
// здесь именно она. Виртуальный аутентификатор — это тот же протокол и тот же
// ES256, что у Face ID; «ненастоящий» в нём только палец.

import { test, expect, type Page } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ME = { username: "e2e_mobtx_me", password: "Pass1234" };
const FRIEND = { username: "e2e_mobtx_friend", password: "Pass1234" };
const ZONE = "E2EMOBTX";
const COOP = "e2e-mobtx-coop";

let meId: string;
let friendId: string;
let zoneId: string;
let myWalletId: string;
let friendWalletId: string;

test.describe.configure({ mode: "serial" });

// Через настоящий домен: WebAuthn привязан к домену, и на localhost ключ,
// выданный для poolwatt.com, не подойдёт — это и есть смысл привязки.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.tokenTransfer.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.cooperative.deleteMany({ where: { name: COOP } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({
    where: { regNumber: { in: [`${COOP}-reg`, `${ZONE}-asset`] } },
  });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.deviceKey.deleteMany({
    where: { user: { username: { in: [ME.username, FRIEND.username] } } },
  });
  await prisma.webAuthnChallenge.deleteMany({
    where: { user: { username: { in: [ME.username, FRIEND.username] } } },
  });
}

/** Виртуальный аутентификатор с проверкой человека — как встроенный в телефон. */
async function addAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(ME.password, 10);
  meId = (
    await prisma.user.upsert({
      where: { username: ME.username },
      update: { passwordHash: hash },
      create: { username: ME.username, passwordHash: hash },
    })
  ).id;
  friendId = (
    await prisma.user.upsert({
      where: { username: FRIEND.username },
      update: { passwordHash: hash },
      create: { username: FRIEND.username, passwordHash: hash },
    })
  ).id;

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E transfer zone", currency: "EUR" },
    })
  ).id;

  // §24.1 — оба в одном кооперативе и с KYC.
  const coopCompany = await prisma.company.create({
    data: {
      legalName: "E2E transfer coop",
      country: "SK",
      regNumber: `${COOP}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  const coop = await prisma.cooperative.create({
    data: { companyId: coopCompany.id, zoneId, name: COOP },
  });
  for (const userId of [meId, friendId]) {
    await prisma.coopMember.create({
      data: { coopId: coop.id, userId, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
    });
  }

  // Партия кВт·ч в моём кошельке — иначе переводить нечего.
  const assetCompany = await prisma.company.create({
    data: {
      legalName: "E2E transfer producer",
      country: "SK",
      regNumber: `${ZONE}-asset`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: assetCompany.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E transfer array",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });
  myWalletId = (
    await prisma.wallet.create({
      data: {
        ownerUserId: meId,
        zoneId,
        currency: "EUR",
        kwhBalance: new Prisma.Decimal(50),
      },
    })
  ).id;
  friendWalletId = (
    await prisma.wallet.create({
      data: { ownerUserId: friendId, zoneId, currency: "EUR" },
    })
  ).id;
  await prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart: new Date(),
      amountKwh: new Prisma.Decimal(50),
      ownerWalletId: myWalletId,
      status: "AVAILABLE",
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("the screen says what the feature is waiting for, and still shows the limits", async ({
  page,
}) => {
  await signInWithPassword(page, ME, "ru");
  await page.goto("/ru/app/contacts");

  // §24.4 — переключатель закрыт на живой сборке.
  await expect(page.getByTestId("transfer-closed")).toContainText("литовского юриста");
  await expect(page.getByTestId("transfer-form")).toHaveCount(0);
  // Пределы и входящие работают и при закрытом переключателе.
  await expect(page.getByTestId("transfer-allowance")).toContainText("500.000");
  await expect(page.getByTestId("incoming-transfers")).toBeVisible();
});

test("my QR to receive is drawn and carries only my nickname", async ({ page }) => {
  await signInWithPassword(page, ME, "ru");
  await page.goto("/ru/app/contacts");

  const qr = page.getByTestId("receive-qr");
  await expect(qr).toBeVisible();
  await expect(page.getByTestId("receive-code")).toHaveText(`PWX:${ME.username}`);
  await expect(qr.locator("svg")).toBeVisible();
});

test("the offline screen draws the same QR without a network", async ({ page }) => {
  await signInWithPassword(page, ME, "ru");
  // Экран перевода кладёт ник в кэш…
  await page.goto("/ru/app/contacts");
  await expect(page.getByTestId("receive-code")).toHaveText(`PWX:${ME.username}`);

  // …и экран офлайна берёт его оттуда.
  await page.goto("/ru/app/offline");
  await expect(page.getByTestId("receive-code")).toHaveText(`PWX:${ME.username}`);
});

test("an incoming transfer is shown, and the closed gate refuses it out loud", async ({ page }) => {
  // Перевод в режиме запроса заводим прямо в базе: отправка стоит за
  // переключателем, а принять его получатель должен уметь.
  const pending = await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: myWalletId,
      toWalletId: friendWalletId,
      amountKwh: new Prisma.Decimal(3),
      note: "за кофе",
      status: "CREATED",
    },
  });

  await signInWithPassword(page, FRIEND, "ru");
  await page.goto("/ru/app/contacts");

  const incoming = page.getByTestId("incoming-transfers");
  await expect(incoming).toContainText("3.000");
  await expect(incoming).toContainText("за кофе");

  await incoming.getByTestId("incoming-accept").first().click();

  // §24.4 закрыт, поэтому подтверждение отклоняется — и экран об этом говорит,
  // а не делает вид, что приняло.
  await expect(page.getByTestId("incoming-error")).toBeVisible();
  const after = await prisma.tokenTransfer.findUniqueOrThrow({ where: { id: pending.id } });
  expect(after.status).toBe("CREATED");

  await prisma.tokenTransfer.delete({ where: { id: pending.id } });
});

test("a device is linked with the built-in authenticator and shows up in the profile", async ({
  page,
}) => {
  await signInWithPassword(page, ME, "ru");
  await addAuthenticator(page);

  await page.goto("/ru/app/profile");
  await expect(page.getByTestId("device-keys")).toBeVisible();
  await page.getByTestId("device-link").click();

  // Сервер проверил подпись и завёл ключ.
  await expect
    .poll(() => prisma.deviceKey.count({ where: { userId: meId } }), { timeout: 20_000 })
    .toBe(1);
  await expect(page.getByTestId("device-forget")).toBeVisible();

  // И забыть его можно только своему хозяину.
  await page.getByTestId("device-forget").click();
  await expect
    .poll(() => prisma.deviceKey.count({ where: { userId: meId } }), { timeout: 20_000 })
    .toBe(0);
});

test("a challenge is good once: the same answer never passes twice", async ({ page }) => {
  await signInWithPassword(page, ME, "ru");
  await page.goto("/ru/app/profile");

  const first = await page.request.post("/api/v1/device-keys/challenge", {
    data: { purpose: "register" },
  });
  expect(first.ok()).toBe(true);
  const { options } = await first.json();

  // Ответ подделать нечем, но вызов уже записан: сервер его съест при первой
  // же попытке и вторую не примет.
  const replay = await page.request.post("/api/v1/device-keys/verify", {
    data: { response: { id: "nope", response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: options.challenge })).toString("base64url") } } },
  });
  expect(replay.status()).toBeGreaterThanOrEqual(400);

  const again = await page.request.post("/api/v1/device-keys/verify", {
    data: { response: { id: "nope", response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: options.challenge })).toString("base64url") } } },
  });
  const body = await again.json();
  expect(body.error).toMatch(/not open/);
});
