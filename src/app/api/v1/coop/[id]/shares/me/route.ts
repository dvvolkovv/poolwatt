// GET /v1/coop/{id}/shares/me — ТЗ §15, US-10 ("количество паёв, доход за
// период, история выплат").
import { notFound, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readMemberShares } from "@/lib/exchange/coop-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const view = await readMemberShares(id, user.id);
  if (!view) return notFound("You are not a member of this cooperative");

  return ok({
    shares: {
      ...view,
      payouts: view.payouts.map((p) => ({
        ...p,
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
    },
  });
}
