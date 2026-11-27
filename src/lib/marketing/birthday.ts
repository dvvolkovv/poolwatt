// §42's birthday trigger: "день рождения клиента".
//
// A pass of the worker, once a day. Two rules decide who gets a gift:
//
//   the date — day and month, because that is all we ask of a person
//   (`User.birthDay`, `User.birthMonth`, given voluntarily in the profile);
//
//   being a client of *this* network — at least one captured charge at a
//   point of the campaign's own scope. Without that rule a partner's birthday
//   campaign would hand its generation to every account in the system, and
//   §42 says "день рождения клиента".
//
// The gift is issued once a year: the key is the year, so a second pass on
// the same day gives nothing and next year gives one again.

import { prisma } from "@/lib/prisma";
import { issueCampaignGifts } from "./campaign-engine";

/** How many clients one pass looks at per campaign. */
const BATCH = 500;

export interface BirthdayDay {
  day: number;
  month: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The birthdays celebrated on this date.
 *
 * Normally just the date itself. On 28 February of a year without a 29th, the
 * people born on the 29th are celebrated too — otherwise their gift would
 * come round every fourth year.
 */
export function birthdaysOn(now: Date): BirthdayDay[] {
  const day = now.getUTCDate();
  const month = now.getUTCMonth() + 1;
  const days: BirthdayDay[] = [{ day, month }];
  if (month === 2 && day === 28 && !isLeapYear(now.getUTCFullYear())) {
    days.push({ day: 29, month: 2 });
  }
  return days;
}

/** US-41's letter is sent by the same sweep that notifies every other gift. */
export async function issueBirthdayGifts(now: Date = new Date()): Promise<string[]> {
  const days = birthdaysOn(now);
  const year = now.getUTCFullYear();

  const campaigns = await prisma.campaign.findMany({
    where: {
      trigger: "BIRTHDAY",
      status: "ACTIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const granted: string[] = [];

  for (const campaign of campaigns) {
    // Clients of this network whose birthday is today. The charge has to be
    // inside the campaign's own scope, the same clause that decides where the
    // gift may then be spent (§42 "Где действует").
    const clients = await prisma.user.findMany({
      where: {
        OR: days.map((d) => ({ birthDay: d.day, birthMonth: d.month })),
        wallets: {
          some: {
            payments: {
              some: {
                status: "CAPTURED",
                point: {
                  operatorId: campaign.operatorId,
                  ...(campaign.scopePointIds.length > 0
                    ? { id: { in: campaign.scopePointIds } }
                    : {}),
                },
              },
            },
          },
        },
      },
      take: BATCH,
      select: { id: true },
    });

    for (const client of clients) {
      try {
        const ids = await issueCampaignGifts(campaign, client.id, null, `birthday-${year}`);
        granted.push(...ids);
      } catch (err) {
        console.error("[campaigns] birthday gift failed for", client.id, err);
      }
    }
  }

  return granted;
}
