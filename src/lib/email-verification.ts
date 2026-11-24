import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/resend";

const TTL_MS = 60 * 60 * 1000;
// The recipient hasn't agreed to anything yet and registration is open to
// everyone, so cap how many links one address can be sent.
const MAX_PER_HOUR = 3;

export async function verificationLimitReached(email: string): Promise<boolean> {
  const recent = await prisma.emailVerificationToken.count({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  return recent >= MAX_PER_HOUR;
}

/**
 * Issues a token and mails the link. user.email stays empty until the link is
 * opened, so nobody can claim an address they don't control.
 *
 * Returns false when the mail couldn't be sent; the token is then dropped, so
 * the cabinet doesn't claim a letter is on its way.
 */
export async function issueEmailVerification(userId: string, email: string, locale: string): Promise<boolean> {
  const token = randomBytes(32).toString("hex");
  await prisma.emailVerificationToken.create({
    data: { token, userId, email, expiresAt: new Date(Date.now() + TTL_MS) },
  });
  try {
    await sendVerificationEmail(email, token, locale);
    return true;
  } catch (err) {
    console.error("[email-verification] send failed:", err);
    await prisma.emailVerificationToken.delete({ where: { token } });
    return false;
  }
}
