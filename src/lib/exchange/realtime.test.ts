// ТЗ §15 — the live channels and the ticket that guards them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_PREFIX,
  TICKET_TTL_SECONDS,
  isKnownChannel,
  isPublicChannel,
  issueTicket,
  orderbookChannel,
  publish,
  telemetryChannel,
  ticketAllows,
  tradesChannel,
  verifyTicket,
  walletChannel,
} from "./realtime";

const NOW = new Date("2026-11-24T12:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-for-tickets");
  vi.stubEnv("NEXTAUTH_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("channel names — §15", () => {
  it("matches the four channels the spec names", () => {
    expect(orderbookChannel("sk")).toBe("orderbook.SK");
    expect(tradesChannel("lt")).toBe("trades.LT");
    expect(walletChannel("usr_1")).toBe("wallet.usr_1");
    expect(telemetryChannel("ast_1")).toBe("telemetry.ast_1");
  });

  it("refuses a channel that is not one of them", () => {
    expect(isKnownChannel("orderbook.SK")).toBe(true);
    expect(isKnownChannel("wallet.usr_1")).toBe(true);
    expect(isKnownChannel("admin.secrets")).toBe(false);
    expect(isKnownChannel("wallet.*")).toBe(false);
    expect(isKnownChannel("wallet.")).toBe(false);
  });

  it("knows which channels anyone may hear", () => {
    expect(isPublicChannel("orderbook.SK")).toBe(true);
    expect(isPublicChannel("trades.SK")).toBe(true);
    expect(isPublicChannel("wallet.usr_1")).toBe(false);
    expect(isPublicChannel("telemetry.ast_1")).toBe(false);
  });
});

describe("tickets", () => {
  it("round-trips the claims", () => {
    const ticket = issueTicket({
      userId: "usr_1",
      channels: ["wallet.usr_1", "orderbook.SK"],
      now: NOW,
    });
    const claims = verifyTicket(ticket, NOW);

    expect(claims).not.toBeNull();
    expect(claims?.userId).toBe("usr_1");
    expect(claims?.channels).toEqual(["wallet.usr_1", "orderbook.SK"]);
    expect(claims?.expiresAt).toBe(Math.floor(NOW.getTime() / 1000) + TICKET_TTL_SECONDS);
  });

  it("drops a channel name that is not a channel", () => {
    const ticket = issueTicket({ userId: "usr_1", channels: ["admin.everything"], now: NOW });
    expect(verifyTicket(ticket, NOW)?.channels).toEqual([]);
  });

  it("expires", () => {
    const ticket = issueTicket({ userId: "usr_1", channels: ["wallet.usr_1"], now: NOW });
    const justBefore = new Date(NOW.getTime() + (TICKET_TTL_SECONDS - 1) * 1000);
    const justAfter = new Date(NOW.getTime() + (TICKET_TTL_SECONDS + 1) * 1000);

    expect(verifyTicket(ticket, justBefore)).not.toBeNull();
    expect(verifyTicket(ticket, justAfter)).toBeNull();
  });

  it("refuses a ticket whose claims were edited", () => {
    const ticket = issueTicket({ userId: "usr_1", channels: ["wallet.usr_1"], now: NOW });
    const [, signature] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({ u: "usr_2", c: ["wallet.usr_2"], e: 9999999999 }),
      "utf8",
    ).toString("base64url");

    expect(verifyTicket(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it("refuses a ticket signed with another secret", () => {
    const ticket = issueTicket({ userId: "usr_1", channels: ["wallet.usr_1"], now: NOW });
    vi.stubEnv("AUTH_SECRET", "a-different-secret");
    expect(verifyTicket(ticket, NOW)).toBeNull();
  });

  it("falls back to the v4 secret name when only that is set", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "only-the-v4-name");
    const ticket = issueTicket({ userId: "usr_1", channels: ["wallet.usr_1"], now: NOW });
    expect(verifyTicket(ticket, NOW)?.userId).toBe("usr_1");
  });

  it("refuses nonsense instead of throwing", () => {
    expect(verifyTicket("", NOW)).toBeNull();
    expect(verifyTicket("no-dot", NOW)).toBeNull();
    expect(verifyTicket("payload.not-hex", NOW)).toBeNull();
    expect(verifyTicket("!!!.".padEnd(68, "a"), NOW)).toBeNull();
  });

  it("only allows the channels it lists", () => {
    const claims = verifyTicket(
      issueTicket({ userId: "usr_1", channels: ["wallet.usr_1"], now: NOW }),
      NOW,
    );
    expect(claims).not.toBeNull();
    expect(ticketAllows(claims!, "wallet.usr_1")).toBe(true);
    expect(ticketAllows(claims!, "wallet.usr_2")).toBe(false);
  });
});

describe("publish", () => {
  it("puts one event on the bus under the channel's key", async () => {
    const sent: { channel: string; message: string }[] = [];
    const ok = await publish("wallet.usr_1", "wallet.updated", { kwhBalance: 12.5 }, {
      publish: async (channel, message) => {
        sent.push({ channel, message });
        return 1;
      },
    });

    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe(`${CHANNEL_PREFIX}wallet.usr_1`);
    const event = JSON.parse(sent[0].message);
    expect(event).toMatchObject({
      channel: "wallet.usr_1",
      type: "wallet.updated",
      data: { kwhBalance: 12.5 },
    });
    expect(Date.parse(event.at)).not.toBeNaN();
  });

  it("stays quiet when the bus is down, rather than failing the caller", async () => {
    const ok = await publish("wallet.usr_1", "wallet.updated", {}, {
      publish: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(ok).toBe(false);
  });

  it("refuses to publish to an unknown channel", async () => {
    let called = false;
    const ok = await publish("admin.everything", "boom", {}, {
      publish: async () => {
        called = true;
        return 1;
      },
    });
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });
});
