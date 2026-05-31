export function matchesDomain(email: string, websiteUrl: string | null | undefined): boolean {
  if (!websiteUrl) return false;
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  const emailDomain = email.slice(at + 1).toLowerCase().trim();
  if (!emailDomain) return false;

  let host: string;
  try {
    const u = new URL(websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`);
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return false;

  return emailDomain === host || emailDomain.endsWith(`.${host}`);
}
