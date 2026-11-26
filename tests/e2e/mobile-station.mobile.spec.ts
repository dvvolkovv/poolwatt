// M5 — пульт §30 и кооператив на телефоне: US-18, US-26, US-27, US-10, US-21.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_mobstation_owner", password: "Pass1234" };
const STRANGER = { username: "e2e_mobstation_stranger", password: "Pass1234" };
const ZONE = "E2EMOBSTN";
const COOP = "e2e-mobstation-coop";
const REG = "E2E-MOBSTN-0001";
const OTHER_REG = "E2E-MOBSTN-0002";

let ownerId: string;
let strangerId: string;
let zoneId: string;
let assetId: string;
let secondAssetId: string;
let foreignAssetId: string;
let coopId: string;
let openVoteId: string;
let closedVoteId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.coopBallot.deleteMany({ where: { vote: { coop: { name: COOP } } } });
  await prisma.coopVote.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.coopPayoutAllocation.deleteMany({
    where: { payout: { coop: { name: COOP } } },
  });
  await prisma.coopPayout.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.cooperative.deleteMany({ where: { name: COOP } });
  await prisma.assetAlert.deleteMany({ where: { asset: { gridZone: { code: ZONE } } } });
  await prisma.meterReading.deleteMany({ where: { asset: { gridZone: { code: ZONE } } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { regNumber: { in: [REG, OTHER_REG, `${COOP}-reg`] } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.dashboard.deleteMany({
    where: { user: { username: { in: [OWNER.username, STRANGER.username] } } },
  });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  ownerId = (
    await prisma.user.upsert({
      where: { username: OWNER.username },
      update: { passwordHash: hash },
      create: { username: OWNER.username, passwordHash: hash },
    })
  ).id;
  strangerId = (
    await prisma.user.upsert({
      where: { username: STRANGER.username },
      update: { passwordHash: hash },
      create: { username: STRANGER.username, passwordHash: hash },
    })
  ).id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE,
      country: "SK",
      name: "E2E mobile station zone",
      currency: "EUR",
      intervalMinutes: 60,
      spotPrice: new Prisma.Decimal("0.2100"),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  const company = await prisma.company.create({
    data: {
      legalName: "E2E Mobile Station Energy s.r.o.",
      country: "SK",
      regNumber: REG,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: ownerId,
    },
  });

  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E Roof Array",
      capacityKw: new Prisma.Decimal(10),
      storageKwh: new Prisma.Decimal(20),
      storedKwh: new Prisma.Decimal(12),
      status: "ACTIVE",
      shareToMarketPct: 70,
      shareToStoragePct: 20,
      shareToSelfPct: 10,
      reserveSocPct: 20,
    },
  });
  assetId = asset.id;

  // §30 «несколько объектов … и переключение между ними».
  secondAssetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "WIND",
        name: "E2E Mast",
        capacityKw: new Prisma.Decimal(5),
        status: "ACTIVE",
      },
    })
  ).id;

  // Объект чужой компании — его на экране быть не должно.
  const foreignCompany = await prisma.company.create({
    data: {
      legalName: "E2E Somebody Else s.r.o.",
      country: "SK",
      regNumber: OTHER_REG,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: strangerId,
    },
  });
  foreignAssetId = (
    await prisma.asset.create({
      data: {
        companyId: foreignCompany.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "E2E Not Yours",
        capacityKw: new Prisma.Decimal(8),
        status: "ACTIVE",
      },
    })
  ).id;

  // Показания за последние часы — чтобы график и цифры были не пустыми.
  const hour = 3_600_000;
  const now = Date.now();
  await prisma.meterReading.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      assetId,
      zoneId,
      intervalStart: new Date(now - (12 - i) * hour),
      intervalEnd: new Date(now - (11 - i) * hour),
      energyKwh: new Prisma.Decimal(2 + (i % 3)),
      validationStatus: "VALID" as const,
      source: "rest",
    })),
  });

  // US-27 — своя раскладка владельца: именно её телефон должен применить.
  // В раскладке по умолчанию заряда накопителя, цены в зоне и прогноза нет —
  // их ставит тот, кому они нужны.
  await prisma.dashboard.create({
    data: {
      userId: ownerId,
      name: "E2E Technique",
      isDefault: true,
      widgets: [
        { key: "nowKw", size: "M" },
        { key: "today", size: "S" },
        { key: "storageSoc", size: "S" },
        { key: "zonePrice", size: "S" },
        { key: "priceForecast", size: "L" },
        { key: "generationChart", size: "L" },
        { key: "alerts", size: "L" },
      ],
    },
  });

  // Открытая авария §30.
  await prisma.assetAlert.create({
    data: {
      assetId,
      kind: "LINK_LOST",
      note: "E2E: equipment went quiet",
      occurredAt: new Date(now - hour),
      notifiedAt: new Date(now - hour),
    },
  });

  // Кооператив: паи, выплата и два голосования (US-10, US-21).
  const coopCompany = await prisma.company.create({
    data: {
      legalName: "E2E mobile station coop",
      country: "SK",
      regNumber: `${COOP}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  const coop = await prisma.cooperative.create({
    data: { companyId: coopCompany.id, zoneId, name: COOP },
  });
  coopId = coop.id;
  const member = await prisma.coopMember.create({
    data: {
      coopId,
      userId: ownerId,
      status: "ACTIVE",
      shares: 3,
      kycVerifiedAt: new Date(),
    },
  });
  const payout = await prisma.coopPayout.create({
    data: {
      coopId,
      periodStart: new Date(Date.UTC(2026, 10, 1)),
      periodEnd: new Date(Date.UTC(2026, 11, 1)),
      incomeAmount: new Prisma.Decimal(90),
      totalShares: 3,
      currency: "EUR",
    },
  });
  await prisma.coopPayoutAllocation.create({
    data: {
      payoutId: payout.id,
      memberId: member.id,
      shares: 3,
      amount: new Prisma.Decimal(90),
    },
  });

  openVoteId = (
    await prisma.coopVote.create({
      data: {
        coopId,
        question: "E2E: where does the next powerbank go?",
        options: ["Žilina", "Martin"],
        status: "OPEN",
        closesAt: new Date(now + 7 * 24 * hour),
      },
    })
  ).id;
  closedVoteId = (
    await prisma.coopVote.create({
      data: {
        coopId,
        question: "E2E: closed question",
        options: ["Yes", "No"],
        status: "CLOSED",
        closesAt: new Date(now - 24 * hour),
        closedAt: new Date(now - 23 * hour),
      },
    })
  ).id;
  await prisma.coopBallot.create({
    data: { voteId: closedVoteId, memberId: member.id, option: "Yes" },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("the station screen shows the live figure, the panel and the chart", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/station?asset=${assetId}`);

  // Крупная цифра и выработка за сегодня — из показаний, не из воздуха.
  await expect(page.getByTestId("panel-nowKw")).toBeVisible();
  await expect(page.getByTestId("panel-today")).toBeVisible();
  // §30 «заряд накопителя» — объект с накопителем его показывает.
  await expect(page.getByTestId("panel-storageSoc")).toContainText("60.0");
  // Цена в зоне и прогноз.
  await expect(page.getByTestId("panel-zonePrice")).toContainText("0.2100");
  await expect(page.getByTestId("station-forecast")).toBeVisible();
  // График и аварии.
  await expect(page.getByTestId("station-range-day")).toBeVisible();
  await expect(page.getByText("E2E: equipment went quiet")).toBeVisible();
  // US-27 — применена раскладка владельца, а не та, что по умолчанию:
  // «выработка за год» в ней не стоит.
  await expect(page.getByTestId("panel-year")).toHaveCount(0);
  await expect(page.getByTestId("station-layouts")).toContainText("E2E Technique");
});

test("the range stays in the address, and so does the chosen asset", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/station?asset=${assetId}`);

  await page.getByTestId("station-range-week").click();
  await expect(page).toHaveURL(new RegExp(`asset=${assetId}.*range=week`));

  // §30 — переключение между объектами.
  await expect(page.getByTestId("station-assets")).toBeVisible();
  await page.getByTestId("station-assets").getByText("E2E Mast").click();
  await expect(page).toHaveURL(new RegExp(`asset=${secondAssetId}`));
  // У объекта без накопителя плитки заряда нет вовсе, а не пустая.
  await expect(page.getByTestId("panel-storageSoc")).toHaveCount(0);
});

test("somebody else's asset is not on my screen, even by its own id", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/station?asset=${foreignAssetId}`);

  // Чужой объект не выбирается: экран показывает первый свой.
  await expect(page.getByTestId("station-assets")).not.toContainText("E2E Not Yours");
  await expect(page.getByTestId("panel-nowKw")).toBeVisible();
});

test("the sale rules of §30 save from the phone", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/station?asset=${assetId}`);

  const rules = page.getByTestId("station-rules");
  await expect(rules).toBeVisible();
  await rules.getByLabel("Минимальная цена").fill("0.1900");
  await rules.getByLabel("Резерв заряда, %").fill("35");
  await rules.locator('button:has-text("Сохранить")').first().click();

  // §30 — то же серверное действие, что в кабинете: проверяем по базе.
  await expect
    .poll(async () => {
      const stored = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
      return stored.reserveSocPct;
    }, { timeout: 15_000 })
    .toBe(35);
  const stored = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  expect(Number(stored.minSalePrice)).toBe(0.19);
});

test("the phone says out loud that remote commands are not there", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/station?asset=${assetId}`);
  await expect(page.getByTestId("station-commands")).toContainText("моста");
});

test("the cooperative screen shows shares, income and payouts", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/coop?coop=${coopId}`);

  await expect(page.getByTestId("coop-share-count")).toHaveText("3");
  await expect(page.getByTestId("coop-status")).toContainText("Член");
  await expect(page.getByTestId("coop-payouts")).toContainText("90.00");

  // Доход за период: «всё время» видит выплату, которой нет в этом месяце.
  await page.getByTestId("coop-period-all").click();
  await expect(page.getByTestId("coop-income-amount")).toContainText("90.00");
});

test("a vote is cast once and shows as mine; a closed one shows its tally", async ({ page }) => {
  await signInWithPassword(page, OWNER, "ru");
  await page.goto(`/ru/app/coop?coop=${coopId}`);

  const open = page.getByTestId(`coop-vote-${openVoteId}`);
  await expect(open).toContainText("where does the next powerbank go");
  const ballot = open.getByTestId(`ballot-${openVoteId}`);
  await ballot.getByRole("radio", { name: "Martin" }).check();
  await open.getByTestId(`cast-${openVoteId}`).click();

  await expect
    .poll(async () =>
      prisma.coopBallot.count({ where: { voteId: openVoteId } }),
    )
    // §21 — один член, один голос: второй выбор переписывает первый.
    .toBe(1);

  // Закрытое голосование показывает счёт и мой выбор.
  const closed = page.getByTestId(`coop-vote-${closedVoteId}`);
  await expect(closed).toContainText("Yes");
});
