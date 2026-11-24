import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport, resendSend } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
  resendSend: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const MAIL = { to: "user@example.com", subject: "Hi", html: "<p>Go <a href=\"https://x.test/a\">https://x.test/a</a></p>" };

// email.ts caches its transports at module level, so every test loads it fresh.
async function load() {
  vi.resetModules();
  return import("./email");
}

beforeEach(() => {
  for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "EMAIL_REPLY_TO", "RESEND_API_KEY"]) {
    vi.stubEnv(k, "");
  }
  createTransport.mockReturnValue({ sendMail });
  sendMail.mockResolvedValue({ messageId: "1" });
  resendSend.mockResolvedValue({ data: { id: "1" }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail over SMTP", () => {
  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "mail.test");
    vi.stubEnv("SMTP_USER", "noreply@poolwatt.com");
    vi.stubEnv("SMTP_PASS", "secret");
  });

  it("uses the mail server on 2525 with mandatory STARTTLS by default", async () => {
    const { sendEmail } = await load();
    await sendEmail(MAIL);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.test",
        port: 2525,
        secure: false,
        requireTLS: true,
        auth: { user: "noreply@poolwatt.com", pass: "secret" },
      }),
    );
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("switches to implicit TLS on 465", async () => {
    vi.stubEnv("SMTP_PORT", "465");
    const { sendEmail } = await load();
    await sendEmail(MAIL);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true, requireTLS: false }));
  });

  it("sends from poolwatt.com with a plain-text part and auto-reply suppression", async () => {
    const { sendEmail } = await load();
    await sendEmail(MAIL);
    const msg = sendMail.mock.calls[0][0];
    expect(msg).toMatchObject({
      from: "Poolwatt <noreply@poolwatt.com>",
      replyTo: "info@poolwatt.com",
      to: MAIL.to,
      subject: MAIL.subject,
      html: MAIL.html,
      text: "Go https://x.test/a",
    });
    expect(msg.headers).toMatchObject({ "Auto-Submitted": "auto-generated" });
  });

  it("propagates a failed delivery to the caller", async () => {
    sendMail.mockRejectedValue(new Error("550 rejected"));
    const { sendEmail } = await load();
    await expect(sendEmail(MAIL)).rejects.toThrow("550 rejected");
  });

  it("reuses one transport across sends", async () => {
    const { sendEmail } = await load();
    await sendEmail(MAIL);
    await sendEmail(MAIL);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});

describe("sendEmail over Resend", () => {
  beforeEach(() => vi.stubEnv("RESEND_API_KEY", "re_test"));

  it("takes over from SMTP when a key is set", async () => {
    vi.stubEnv("SMTP_HOST", "mail.test");
    vi.stubEnv("SMTP_USER", "noreply@poolwatt.com");
    vi.stubEnv("SMTP_PASS", "secret");
    const { sendEmail } = await load();
    await sendEmail(MAIL);
    expect(resendSend).toHaveBeenCalledWith(expect.objectContaining({ to: [MAIL.to] }));
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("throws on an API error instead of reporting success", async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } });
    const { sendEmail } = await load();
    await expect(sendEmail(MAIL)).rejects.toThrow("domain not verified");
  });
});

describe("sendEmail with no transport configured", () => {
  it("throws in production so users are not told a mail was sent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { sendEmail } = await load();
    await expect(sendEmail(MAIL)).rejects.toThrow("not configured");
  });

  it("logs the text body outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendEmail } = await load();
    await sendEmail(MAIL);
    expect(log.mock.calls[0].join(" ")).toContain("https://x.test/a");
  });
});
