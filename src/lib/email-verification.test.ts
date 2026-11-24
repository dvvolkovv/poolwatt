import { beforeEach, describe, expect, it, vi } from "vitest";

const { token, send } = vi.hoisted(() => ({
  token: { count: vi.fn(), create: vi.fn(), delete: vi.fn() },
  send: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { emailVerificationToken: token } }));
vi.mock("@/lib/resend", () => ({ sendVerificationEmail: send }));

import { issueEmailVerification, verificationLimitReached } from "./email-verification";

beforeEach(() => {
  send.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("issueEmailVerification", () => {
  it("stores a token for the address and mails it in the given language", async () => {
    expect(await issueEmailVerification("u1", "a@b.test", "uk")).toBe(true);
    const { data } = token.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "u1", email: "a@b.test" });
    expect(send).toHaveBeenCalledWith("a@b.test", data.token, "uk");
  });

  it("drops the token and reports failure when the mail can't be sent", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    expect(await issueEmailVerification("u1", "a@b.test", "en")).toBe(false);
    expect(token.delete).toHaveBeenCalledWith({ where: { token: token.create.mock.calls[0][0].data.token } });
  });
});

describe("verificationLimitReached", () => {
  it.each([[2, false], [3, true]])("with %i links in the last hour -> %s", async (n, expected) => {
    token.count.mockResolvedValue(n);
    expect(await verificationLimitReached("a@b.test")).toBe(expected);
  });
});
