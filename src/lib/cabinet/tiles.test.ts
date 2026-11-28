import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CABINET_BOARDS,
  GROUP_KEYS,
  boardOf,
  canOpenGroup,
  GROUP_NEEDS,
  parentPath,
  orderTiles,
  sanitizeTileOrder,
  tilesFor,
  type Capabilities,
  type TileDef,
} from "./tiles";

const APP_DIR = join(process.cwd(), "src", "app", "[locale]");

function pageFileFor(href: string): string {
  return join(APP_DIR, ...href.split("/").filter(Boolean), "page.tsx");
}

const NOBODY: Capabilities = {
  hasCompany: false,
  hasProducer: false,
  isContractor: false,
  hasNetwork: false,
  isCoopMember: false,
  isStaff: false,
  isOperator: false,
};

const EVERYBODY: Capabilities = {
  hasCompany: true,
  hasProducer: true,
  isContractor: true,
  hasNetwork: true,
  isCoopMember: true,
  isStaff: true,
  isOperator: true,
};

function leaves(): TileDef[] {
  return Object.values(CABINET_BOARDS)
    .flat()
    .filter((tile) => tile.target.kind === "page");
}

describe("CABINET_BOARDS", () => {
  it("каждая плитка-лист ведёт на страницу, которая есть на диске", () => {
    const dead = leaves()
      .filter(
        (tile) =>
          tile.target.kind === "page" &&
          !existsSync(pageFileFor(tile.target.href)),
      )
      .map((tile) => tile.key);
    expect(dead).toEqual([]);
  });

  it("каждая плитка-узел ведёт на доску, которая есть", () => {
    for (const tile of Object.values(CABINET_BOARDS).flat()) {
      if (tile.target.kind === "group") {
        expect(GROUP_KEYS).toContain(tile.target.group);
      }
    }
  });

  it("ключи плиток не повторяются", () => {
    const keys = Object.values(CABINET_BOARDS)
      .flat()
      .map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("группы из одной плитки не бывает: это лишнее нажатие", () => {
    for (const group of GROUP_KEYS) {
      expect(CABINET_BOARDS[group].length).toBeGreaterThan(1);
    }
  });
});

describe("tilesFor", () => {
  it("плитки без способности нет вовсе, а не серой", () => {
    const keys = tilesFor("root", NOBODY).map((t) => t.key);
    expect(keys).not.toContain("workOrders");
    expect(keys).not.toContain("coop");
    expect(keys).not.toContain("operator");
    expect(keys).not.toContain("network");
  });

  it("со всеми способностями плиток больше", () => {
    expect(tilesFor("root", EVERYBODY).length).toBeGreaterThan(
      tilesFor("root", NOBODY).length,
    );
  });

  it("свежему аккаунту всё равно есть что нажать", () => {
    const keys = tilesFor("root", NOBODY).map((t) => t.key);
    expect(keys).toContain("wallet");
    expect(keys).toContain("support");
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });

  it("доска настроек одинакова для всех: это свой аккаунт", () => {
    expect(tilesFor("account", NOBODY).map((t) => t.key)).toEqual(
      tilesFor("account", EVERYBODY).map((t) => t.key),
    );
  });
});

describe("orderTiles", () => {
  const defs = tilesFor("root", NOBODY);

  it("без сохранённого порядка оставляет порядок каталога", () => {
    expect(orderTiles(defs, null).map((t) => t.key)).toEqual(
      defs.map((t) => t.key),
    );
  });

  it("уважает сохранённый порядок", () => {
    const reversed = defs.map((t) => t.key).reverse();
    expect(orderTiles(defs, reversed).map((t) => t.key)).toEqual(reversed);
  });

  it("незнакомый ключ отбрасывает, а не роняет доску", () => {
    const saved = ["no-such-tile", ...defs.map((t) => t.key)];
    expect(orderTiles(defs, saved).map((t) => t.key)).toEqual(
      defs.map((t) => t.key),
    );
  });

  it("новую плитку дописывает в конец, а не теряет", () => {
    // Человек настроил порядок, потом получил компанию.
    const savedBefore = defs.map((t) => t.key);
    const withCompany = tilesFor("root", { ...NOBODY, hasCompany: true });
    const ordered = orderTiles(withCompany, savedBefore).map((t) => t.key);
    expect(ordered).toContain("company");
    expect(ordered.length).toBe(withCompany.length);
    expect(ordered.slice(0, savedBefore.length)).toEqual(savedBefore);
  });

  it("мусор вместо списка переживает молча", () => {
    expect(orderTiles(defs, ["", "", ""]).map((t) => t.key)).toEqual(
      defs.map((t) => t.key),
    );
  });
});

describe("boardOf и parentPath", () => {
  it("у дома кабинета родителя нет: он и есть дом", () => {
    expect(parentPath("/me")).toBeNull();
  });

  it("с доски группы кнопка ведёт домой", () => {
    expect(parentPath("/me/g/operator")).toBe("/me");
    expect(parentPath("/me/g/account")).toBe("/me");
  });

  it("со страницы кабинета — на её доску", () => {
    expect(parentPath("/me/wallet")).toBe("/me");
    expect(parentPath("/me/settings")).toBe("/me/g/account");
    expect(parentPath("/me/settings/interface")).toBe("/me/g/account");
  });

  it("со страницы оператора — на доску оператора", () => {
    expect(parentPath("/admin/listings")).toBe("/me/g/operator");
    expect(parentPath("/admin/zones")).toBe("/me/g/operator");
  });

  it("вложенный адрес раздела всё равно знает свою доску", () => {
    expect(parentPath("/me/listing/abc123")).toBe("/me");
    expect(parentPath("/admin/listings/abc123")).toBe("/me/g/operator");
  });

  it("незнакомый адрес ведёт домой, а не в никуда", () => {
    expect(parentPath("/me/no-such-section")).toBe("/me");
  });

  it("boardOf называет доску, на которой плитка живёт", () => {
    expect(boardOf("wallet")).toBe("root");
    expect(boardOf("interface")).toBe("account");
    expect(boardOf("adminZones")).toBe("operator");
  });
});

describe("sanitizeTileOrder", () => {
  const allowed = ["wallet", "buy", "support"];

  it("оставляет только разрешённые ключи", () => {
    expect(
      sanitizeTileOrder(["support", "operator", "wallet"], allowed),
    ).toEqual(["support", "wallet"]);
  });

  it("убирает повторы", () => {
    expect(sanitizeTileOrder(["wallet", "wallet", "buy"], allowed)).toEqual([
      "wallet",
      "buy",
    ]);
  });

  it("мусор из браузера в базу не попадает", () => {
    expect(sanitizeTileOrder("не массив", allowed)).toEqual([]);
    expect(sanitizeTileOrder([1, null, {}, "wallet"], allowed)).toEqual([
      "wallet",
    ]);
  });
});

describe("canOpenGroup", () => {
  it("доска оператора — только оператору", () => {
    // Доска набрана из обычных плиток без своих требований, поэтому право
    // берётся с плитки-двери, а не с содержимого доски.
    expect(canOpenGroup("operator", NOBODY)).toBe(false);
    expect(canOpenGroup("operator", { ...NOBODY, isOperator: true })).toBe(
      true,
    );
  });

  it("доска своего аккаунта открыта каждому: это его аккаунт", () => {
    expect(canOpenGroup("account", NOBODY)).toBe(true);
  });

  it("у каждой группы объявлено право, и ни одна не забыта", () => {
    for (const group of GROUP_KEYS) {
      expect(Object.keys(GROUP_NEEDS)).toContain(group);
    }
    expect(Object.keys(GROUP_NEEDS).sort()).toEqual([...GROUP_KEYS].sort());
  });
});
