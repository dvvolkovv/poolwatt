// DELETE /v1/device-keys/{id} — отвязать устройство (§25).
//
// Своё только: отвязать чужое устройство означало бы снять с чужого счёта
// подтверждение операций.

import { NextResponse } from "next/server";
import { notFound, sessionUser, unauthorized } from "@/lib/exchange/api";
import { forgetDevice } from "@/lib/webauthn/device-keys";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { id } = await params;
  if (!(await forgetDevice(user.id, id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
