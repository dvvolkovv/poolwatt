// GET /v1/receipts/{id} — ТЗ §15, §46.
import { notFound, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readReceiptForUser } from "@/lib/exchange/payment-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  // Who may read a receipt is a rule of the service (§46); a receipt that is
  // not the caller's reads as absent, so the endpoint tells nobody what
  // exists.
  const receipt = await readReceiptForUser(id, user.id, user.role === "ADMIN");
  if (!receipt) return notFound("Receipt not found");

  return ok({ receipt: { ...receipt, issuedAt: receipt.issuedAt.toISOString() } });
}
