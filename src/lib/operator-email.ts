// Where operator notifications go — listing applications (ТЗ §12 US-01), build
// requests, contractor registrations.
//
// ADMIN_EMAIL was optional and unset in production, so every one of these
// notifications was dropped with a warning in a log nobody reads. The reply-to
// inbox is already configured and is read by the same person, so it is the
// fallback; ADMIN_EMAIL still wins when the owner wants them elsewhere.

type Env = Record<string, string | undefined>;

export function operatorEmail(env: Env = process.env): string | null {
  return env.ADMIN_EMAIL?.trim() || env.EMAIL_REPLY_TO?.trim() || null;
}
