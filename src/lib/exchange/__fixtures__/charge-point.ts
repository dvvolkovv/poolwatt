// Пункт с двумя разъёмами, сеть с владельцем и водитель с партиями — всё,
// что нужно сеансу зарядки, и ничего больше.
//
// Отдельным модулем, потому что сеанс проверяется двумя файлами: обычными
// случаями и одновременностью. Каждый вызывающий передаёт свой префикс и код
// зоны, иначе два файла, идущие рядом, стирают данные друг у друга.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "../wallet-service";
import { placeOrder } from "../order-service";

export interface ChargePointFixture {
  zoneId: string;
  driverUserId: string;
  operatorUserId: string;
  operatorId: string;
  walletId: string;
  sellerUserId: string;
  pointId: string;
  connectorId: string;
  secondConnectorId: string;
}

export interface SeedArgs {
  /** Префикс всех созданных имён; по нему же идёт уборка. */
  prefix: string;
  zoneCode: string;
  kwhBalance?: number;
  fiatBalance?: number;
  /** §16.5 — спотовый ориентир зоны: от него считается коридор цены. */
  spotPrice?: number;
  /** Сколько кВт·ч выставить в книгу на продажу и по какой цене. */
  book?: { amountKwh: number; price: number };
}

export async function wipeChargePoint(prefix: string, zoneCode: string): Promise<void> {
  await prisma.chargeSessionTick.deleteMany({
    where: { session: { zone: { code: zoneCode } } },
  });
  await prisma.chargeSession.deleteMany({ where: { zone: { code: zoneCode } } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: zoneCode } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: zoneCode } } });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: { startsWith: prefix } } } } });
  await prisma.order.deleteMany({ where: { zone: { code: zoneCode } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: zoneCode } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: zoneCode } } });
  await prisma.pointApiKey.deleteMany({
    where: { point: { operator: { slug: { startsWith: prefix } } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: prefix } } },
  });
  await prisma.operatorAccounting.deleteMany({
    where: { operator: { slug: { startsWith: prefix } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${prefix}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${prefix}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: zoneCode } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
}

export async function seedChargePoint(args: SeedArgs): Promise<ChargePointFixture> {
  const { prefix, zoneCode } = args;

  const zone = await prisma.gridZone.create({
    data: {
      code: zoneCode,
      country: "SK",
      name: `${prefix} zone`,
      currency: "EUR",
      ...(args.spotPrice != null
        ? { spotPrice: new Prisma.Decimal(args.spotPrice), spotPriceAt: new Date() }
        : {}),
    },
  });

  const driver = await prisma.user.create({
    data: { username: `${prefix}driver`, passwordHash: "x" },
  });
  const owner = await prisma.user.create({
    data: { username: `${prefix}owner`, passwordHash: "x" },
  });
  const seller = await prisma.user.create({
    data: { username: `${prefix}seller`, passwordHash: "x" },
  });

  const company = await prisma.company.create({
    data: {
      legalName: `${prefix} producer`,
      country: "SK",
      regNumber: `${prefix}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zone.id,
      kind: "SOLAR",
      name: `${prefix} roof`,
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });

  const operator = await prisma.chargerOperator.create({
    data: {
      slug: `${prefix}net`,
      displayName: `${prefix} network`,
      claimedById: owner.id,
      claimedAt: new Date(),
    },
  });
  await prisma.operatorAccounting.create({
    data: { operatorId: operator.id, legalName: `${prefix} network s.r.o.` },
  });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: `${prefix} depot`,
      status: "PUBLISHED",
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      latitude: 48.15,
      longitude: 17.1,
      gridZoneId: zone.id,
      open24: true,
      publishedAt: new Date(),
      connectors: {
        create: [
          { type: "CCS2", powerKw: new Prisma.Decimal(150), quantity: 1, status: "FREE" },
          { type: "TYPE2", powerKw: new Prisma.Decimal(22), quantity: 1, status: "FREE" },
        ],
      },
      tariffs: {
        create: [
          {
            priceFiat: new Prisma.Decimal(0.3),
            priceTokens: new Prisma.Decimal(1),
            currency: "EUR",
          },
        ],
      },
    },
    include: { connectors: { orderBy: { powerKw: "desc" } } },
  });

  const wallet = await getOrCreateWallet(driver.id, zone.id);
  if (args.fiatBalance) {
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { fiatBalance: new Prisma.Decimal(args.fiatBalance) },
    });
  }
  if (args.kwhBalance) {
    await prisma.energyToken.create({
      data: {
        zoneId: zone.id,
        assetId: asset.id,
        ownerWalletId: wallet.id,
        amountKwh: new Prisma.Decimal(args.kwhBalance),
        intervalStart: new Date(),
        status: "AVAILABLE",
      },
    });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { kwhBalance: new Prisma.Decimal(args.kwhBalance) },
    });
  }

  // Книга с настоящей стоящей заявкой: без неё покупка недостающего в §16.6
  // не исполняется, и сеанс падает там, где по расчёту должен пройти.
  if (args.book) {
    const sellerWallet = await getOrCreateWallet(seller.id, zone.id);
    await prisma.energyToken.create({
      data: {
        zoneId: zone.id,
        assetId: asset.id,
        ownerWalletId: sellerWallet.id,
        amountKwh: new Prisma.Decimal(args.book.amountKwh),
        intervalStart: new Date(),
        status: "AVAILABLE",
      },
    });
    await prisma.wallet.update({
      where: { id: sellerWallet.id },
      data: { kwhBalance: new Prisma.Decimal(args.book.amountKwh) },
    });
    await placeOrder({
      userId: seller.id,
      zoneId: zone.id,
      side: "SELL",
      type: "LIMIT",
      amountKwh: args.book.amountKwh,
      limitPrice: args.book.price,
    });
  }

  return {
    zoneId: zone.id,
    driverUserId: driver.id,
    operatorUserId: owner.id,
    operatorId: operator.id,
    walletId: wallet.id,
    sellerUserId: seller.id,
    pointId: point.id,
    connectorId: point.connectors[0]!.id,
    secondConnectorId: point.connectors[1]!.id,
  };
}
