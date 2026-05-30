import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("verifyEmail");

  // Look up the token. Anyone with the link can consume it (it's the secret).
  // We don't require a session — useful if the user opens the link in a fresh
  // browser. The token-id lookup is constant-time enough for our scale.
  let outcome: "ok" | "expired" | "missing" | "notfound" = "missing";
  if (token) {
    const rec = await prisma.emailVerificationToken.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!rec) {
      outcome = "notfound";
    } else if (rec.expiresAt.getTime() < Date.now()) {
      outcome = "expired";
      await prisma.emailVerificationToken.delete({ where: { token } });
    } else {
      // Apply: set user.email + user.emailVerified, drop all this user's
      // pending tokens (housekeeping; only one can be valid at a time).
      await prisma.$transaction([
        prisma.user.update({
          where: { id: rec.userId },
          data: { email: rec.email, emailVerified: new Date() },
        }),
        prisma.emailVerificationToken.deleteMany({ where: { userId: rec.userId } }),
      ]);
      outcome = "ok";
    }
  }

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-3">
          {t(`${outcome}.title`)}
        </h1>
        <p className="text-sm text-muted mb-8">{t(`${outcome}.body`)}</p>
        <Link
          href={`/${locale}/me/settings`}
          className="inline-flex items-center px-5 py-3 rounded-full font-semibold text-[13px] uppercase tracking-[0.18em] bg-accent text-accent-foreground glow-accent transition-all hover:brightness-110"
        >
          {t("backToSettings")}
        </Link>
      </div>
    </main>
  );
}
