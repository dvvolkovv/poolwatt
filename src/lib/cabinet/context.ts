// Всё, что доске плиток нужно знать о человеке, одним проходом: его
// способности (какие плитки вообще существуют), цифры на плитках и настройки
// интерфейса. Тот же приём, что `readShellContext` для телефонной оболочки —
// один `Promise.all`, а не запрос на плитку.
//
// Каждый запрос здесь повторяет тот, которым живёт сама страница раздела:
// «Производитель» — `claimedById`, как `/me/producer`, «Сеть зарядок» —
// `claimedById`, как `/me/charger-operator`, «Подрядчик» — членство, как
// `/me/contractor`. Иначе плитка обещала бы раздел, который окажется пустым.

import {
  BuildRequestStatus,
  CoopMemberStatus,
  ReservationStatus,
  TicketStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundKwh } from "@/lib/exchange/precision";
import { readUserStatus, type UserStatus } from "@/lib/exchange/user-status";
import { readWallets } from "@/lib/exchange/wallet-service";
import { parseTileAccent, type TileAccent } from "./accents";
import type { Capabilities, TileValueKey } from "./tiles";

export interface TileValue {
  primary: string;
  secondary?: string;
}

export interface CabinetContext {
  username: string;
  status: UserStatus;
  caps: Capabilities;
  accent: TileAccent;
  /** Порядок плиток дома кабинета, как его разложил человек. */
  order: string[] | null;
  values: Partial<Record<TileValueKey, TileValue>>;
}

/** Бронь впереди — созданная или подтверждённая; отменённая и прошедшая не считаются. */
const AHEAD = [ReservationStatus.CREATED, ReservationStatus.ACTIVE];
/** Открытая заявка: решённая и закрытая в цифру на плитке не идут. */
const OPEN_TICKETS = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS];
/** Заявка на строительство в работе. */
const LIVE_BUILD = [BuildRequestStatus.OPEN, BuildRequestStatus.MATCHED];
/** Наряд, который ещё мой. */
const MY_ORDERS_DONE = [
  WorkOrderStatus.DONE,
  WorkOrderStatus.VERIFIED,
  WorkOrderStatus.CANCELLED,
];

function parseOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const keys = raw.filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  return keys.length > 0 ? keys : null;
}

export async function readCabinetContext(
  userId: string,
  isOperator: boolean,
): Promise<CabinetContext> {
  const now = new Date();

  const [
    user,
    status,
    wallets,
    company,
    producer,
    network,
    membership,
    member,
    staff,
    bookingsAhead,
    favoritesCount,
    openTickets,
    activeGifts,
    buildRequests,
    myWorkOrders,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, tileAccent: true, tileOrder: true },
    }),
    readUserStatus(userId),
    readWallets(userId),
    prisma.company.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    }),
    prisma.producer.findFirst({
      where: { claimedById: userId },
      select: { id: true },
    }),
    prisma.chargerOperator.findFirst({
      where: { claimedById: userId },
      select: { id: true },
    }),
    prisma.contractorMember.findFirst({
      where: { userId },
      select: { contractorId: true },
    }),
    prisma.coopMember.findFirst({
      where: { userId, status: CoopMemberStatus.ACTIVE, shares: { gt: 0 } },
      select: { shares: true },
    }),
    prisma.employee.findFirst({
      where: { userId, role: { permissions: { has: "workorders.read" } } },
      select: { id: true },
    }),
    prisma.reservation.count({
      where: { userId, status: { in: AHEAD }, windowEnd: { gte: now } },
    }),
    prisma.chargerFavorite.count({ where: { userId } }),
    prisma.ticket.count({
      where: { reporterId: userId, status: { in: OPEN_TICKETS } },
    }),
    // Те же условия, что у списка на `/me/gifts` (`readMyGifts`): цифра на
    // плитке обязана совпасть с тем, что человек увидит, открыв её.
    prisma.promoGrant.count({
      where: {
        userId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        campaign: { status: { in: ["ACTIVE", "PAUSED", "EXHAUSTED"] } },
      },
    }),
    prisma.buildRequest.count({
      where: { userId, status: { in: LIVE_BUILD } },
    }),
    prisma.workOrder.count({
      where: { assignee: { userId }, status: { notIn: MY_ORDERS_DONE } },
    }),
  ]);

  const totalKwh = roundKwh(wallets.reduce((sum, w) => sum + w.kwhBalance, 0));
  const primaryWallet =
    wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;

  const values: Partial<Record<TileValueKey, TileValue>> = {};
  // Кошелёк печатает баланс всегда, даже нулевой: ноль на счёте — это ответ,
  // которого человек и пришёл за. Остальные плитки молчат, когда считать
  // нечего: «0 броней» занимает место и ничего не говорит.
  values.walletBalance = {
    primary: totalKwh.toFixed(3),
    secondary: primaryWallet
      ? `${primaryWallet.fiatBalance.toFixed(2)} ${primaryWallet.currency}`
      : undefined,
  };
  if (bookingsAhead > 0)
    values.bookingsAhead = { primary: String(bookingsAhead) };
  if (favoritesCount > 0)
    values.favoritesCount = { primary: String(favoritesCount) };
  if (openTickets > 0) values.openTickets = { primary: String(openTickets) };
  if (activeGifts > 0) values.activeGifts = { primary: String(activeGifts) };
  if (buildRequests > 0)
    values.buildRequests = { primary: String(buildRequests) };
  if (member?.shares) values.coopShares = { primary: String(member.shares) };
  if (myWorkOrders > 0) values.myWorkOrders = { primary: String(myWorkOrders) };

  return {
    username: user?.username ?? "",
    status,
    caps: {
      hasCompany: Boolean(company),
      hasProducer: Boolean(producer),
      hasNetwork: Boolean(network),
      isContractor: Boolean(membership),
      isCoopMember: Boolean(member),
      isStaff: Boolean(staff),
      isOperator,
    },
    accent: parseTileAccent(user?.tileAccent),
    order: parseOrder(user?.tileOrder),
    values,
  };
}
