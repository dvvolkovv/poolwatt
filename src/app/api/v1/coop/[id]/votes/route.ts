// GET /v1/coop/{id}/votes — US-21 ("результаты видны после закрытия
// голосования"): open votes carry no tallies, closed ones carry the result.
import { forbidden, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readMemberShares, readVoteOutcome } from "@/lib/exchange/coop-service";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const member = await readMemberShares(id, user.id);
  if (!member && user.role !== "ADMIN") return forbidden("Members only");

  const votes = await prisma.coopVote.findMany({
    where: { coopId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return ok({
    votes: await Promise.all(
      votes.map(async (vote) => ({
        id: vote.id,
        question: vote.question,
        options: vote.options,
        status: vote.status,
        opensAt: vote.opensAt.toISOString(),
        closesAt: vote.closesAt.toISOString(),
        closedAt: vote.closedAt?.toISOString() ?? null,
        result: vote.status === "CLOSED" ? await readVoteOutcome(vote.id) : null,
      })),
    ),
  });
}
