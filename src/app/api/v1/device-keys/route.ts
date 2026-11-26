// GET /v1/device-keys — какие устройства привязаны к этому счёту (§25).

import { ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { listDevices } from "@/lib/webauthn/device-keys";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();
  return ok({ devices: await listDevices(user.id) });
}
