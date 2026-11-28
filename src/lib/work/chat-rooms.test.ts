import { describe, it, expect } from "vitest";
import { roomKey, parseRoomKey, chatChannel } from "./chat-rooms";

describe("ключ комнаты", () => {
  it("собирается из вида и ссылки", () => {
    expect(roomKey({ kind: "NETWORK", id: "op1" })).toBe("net-op1");
    expect(roomKey({ kind: "CREW", id: "c1" })).toBe("crew-c1");
    expect(roomKey({ kind: "WORK_ORDER", id: "w1" })).toBe("wo-w1");
  });

  it("разбирается обратно", () => {
    expect(parseRoomKey("net-op1")).toEqual({ kind: "NETWORK", id: "op1" });
    expect(parseRoomKey("crew-c1")).toEqual({ kind: "CREW", id: "c1" });
    expect(parseRoomKey("wo-w1")).toEqual({ kind: "WORK_ORDER", id: "w1" });
  });

  it("мусор не разбирается", () => {
    const bad = [
      "",
      "net-",
      "nope-1",
      "wo",
      "wo-a b",
      "net-a.b",
      "wo-../../etc",
      `crew-${"x".repeat(200)}`,
    ];
    for (const key of bad) {
      expect(parseRoomKey(key), key).toBeNull();
    }
  });

  it("имя канала §15 — это ключ с приставкой", () => {
    expect(chatChannel("wo-w1")).toBe("team.wo-w1");
  });

  it("то, что собрано, разбирается, и наоборот", () => {
    for (const ref of [
      { kind: "NETWORK" as const, id: "clz0000000000000000000000" },
      { kind: "CREW" as const, id: "clz1111111111111111111111" },
      { kind: "WORK_ORDER" as const, id: "clz2222222222222222222222" },
    ]) {
      expect(parseRoomKey(roomKey(ref))).toEqual(ref);
    }
  });
});
