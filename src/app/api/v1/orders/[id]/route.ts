// DELETE /v1/orders/{id} — ТЗ §15, §14 cancellation.
import { domainError, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { cancelOrder } from "@/lib/exchange/order-service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  try {
    await cancelOrder(id, user.id);
    return ok({ orderId: id, status: "CANCELLED" });
  } catch (err) {
    return domainError(err);
  }
}
