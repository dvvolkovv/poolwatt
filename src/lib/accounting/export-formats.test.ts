// US-46 — "Выгрузка за выбранный период во всех форматах": CSV, Excel, PDF,
// DATEV, BMD.
//
// Two things are tested here. The shape of each file, so an accountant's
// software recognises it; and the refusal of DATEV and BMD when the partner
// has not supplied account numbers — a posting to an invented Sachkonto costs
// more to undo than a missing file costs to wait for.

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import type { Ledger } from "./ledger";
import { AccountingExportError, exportLedger, EXPORT_FORMATS } from "./export";

const baseLedger: Ledger = {
  network: {
    operatorId: "op_1",
    displayName: "Ledger network",
    legalName: "Ledger s.r.o.",
    regNumber: "12345678",
    vatNumber: "SK2020123456",
    address: "Hlavná 1, Košice, SK",
  },
  from: new Date("2026-03-01T00:00:00Z"),
  to: new Date("2026-04-01T00:00:00Z"),
  currency: "EUR",
  vatRatePct: 20,
  lines: [
    {
      date: new Date("2026-03-02T10:00:00Z"),
      documentNumber: "PW-2026-000001",
      correctedReceiptId: null,
    receiptId: "rc_1",
      kind: "charge",
      pointId: "p_a",
      pointName: "Point A",
      kwh: 10,
      gross: 4.2,
      net: 3.5,
      vat: 0.7,
      vatRatePct: 20,
      currency: "EUR",
      platformFee: 0.09,
      subpartnerFee: 0,
      partnerNet: 4.11,
    },
    {
      date: new Date("2026-03-18T09:15:00Z"),
      documentNumber: "PW-2026-000002",
      correctedReceiptId: null,
    receiptId: "rc_2",
      kind: "reservation.no_show",
      pointId: "p_b",
      pointName: "Point B",
      kwh: 0,
      gross: 3,
      net: 2.5,
      vat: 0.5,
      vatRatePct: 20,
      currency: "EUR",
      platformFee: 0.06,
      subpartnerFee: 0.3,
      partnerNet: 2.64,
    },
  ],
  totals: {
    kwh: 10,
    gross: 7.2,
    net: 6,
    vat: 1.2,
    platformFee: 0.15,
    subpartnerFee: 0.3,
    partnerNet: 6.75,
  },
  accounts: {
    datevConsultantNo: "1234567",
    datevClientNo: "77001",
    revenueAccount: "8400",
    counterAccount: "10000",
    fiscalYearStart: 1,
    bmdClientNo: "5001",
  },
};

const noAccounts: Ledger = {
  ...baseLedger,
  accounts: {
    datevConsultantNo: null,
    datevClientNo: null,
    revenueAccount: null,
    counterAccount: null,
    fiscalYearStart: 1,
    bmdClientNo: null,
  },
};

describe("exportLedger", () => {
  it("offers exactly the five formats §46 lists", () => {
    expect([...EXPORT_FORMATS].sort()).toEqual(["bmd", "csv", "datev", "pdf", "xlsx"]);
  });

  it("names the file after the network and the period", async () => {
    const file = await exportLedger(baseLedger, "csv");
    expect(file.filename).toBe("poolwatt-2026-03-01-2026-03-31-ledger-network.csv");
    expect(file.contentType).toContain("csv");
  });

  it("refuses a format it does not know", async () => {
    // @ts-expect-error — the point is the runtime guard.
    await expect(exportLedger(baseLedger, "doc")).rejects.toThrow(AccountingExportError);
  });
});

describe("CSV", () => {
  it("is semicolon-separated with a BOM, the way European Excel opens it", async () => {
    const file = await exportLedger(baseLedger, "csv");
    const text = file.body.toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const rows = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows[0].split(";")).toContain("document");
    expect(rows).toHaveLength(1 + 2 + 1); // header, two lines, totals
    expect(rows[1]).toContain("PW-2026-000001");
    expect(rows[1]).toContain("Point A");
  });

  it("writes money the way the accountant's locale reads it", async () => {
    const text = (await exportLedger(baseLedger, "csv")).body.toString("utf8");
    expect(text).toContain("4,20");
    expect(text).toContain('"7,20"');
  });

  it("cannot be used to smuggle a formula into Excel", async () => {
    const dodgy: Ledger = {
      ...baseLedger,
      lines: [{ ...baseLedger.lines[0], pointName: "=HYPERLINK(\"http://evil\")" }],
    };
    const text = (await exportLedger(dodgy, "csv")).body.toString("utf8");
    expect(text).not.toMatch(/;"?=HYPERLINK/);
    expect(text).toContain("'=HYPERLINK");
  });
});

describe("Excel", () => {
  it("is a workbook with the lines and a total row", async () => {
    const file = await exportLedger(baseLedger, "xlsx");
    const wb = new ExcelJS.Workbook();
    // exceljs ships its own Buffer typing, older than the one @types/node
    // gives us here; the value is the same bytes either way.
    await wb.xlsx.load(file.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const sheet = wb.worksheets[0];
    expect(sheet.name).toBe("2026-03");
    // Requisites block, header, two lines, totals.
    expect(sheet.rowCount).toBeGreaterThanOrEqual(6);
    const values = sheet.getSheetValues().flatMap((row) =>
      Array.isArray(row) ? row.map((c) => (typeof c === "object" && c !== null ? JSON.stringify(c) : c)) : [],
    );
    expect(values).toContain("PW-2026-000001");
    expect(values).toContain("Ledger s.r.o.");
    expect(values).toContain(4.2);
  });
});

describe("PDF", () => {
  it("is a real PDF with the network on it", async () => {
    const file = await exportLedger(baseLedger, "pdf");
    expect(file.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(file.body.length).toBeGreaterThan(1000);
    expect(file.contentType).toBe("application/pdf");
  });
});

describe("DATEV", () => {
  it("writes an EXTF Buchungsstapel header DATEV recognises", async () => {
    const text = (await exportLedger(baseLedger, "datev")).body.toString("utf8").replace(/^﻿/, "");
    const rows = text.trim().split("\r\n");
    expect(rows[0].startsWith('"EXTF";700;21;"Buchungsstapel";')).toBe(true);
    expect(rows[0]).toContain("1234567");
    expect(rows[0]).toContain("77001");
    expect(rows[1].split(";")[0]).toBe("Umsatz (ohne Soll/Haben-Kz)");
  });

  it("posts each document between the revenue and the counter account", async () => {
    const text = (await exportLedger(baseLedger, "datev")).body.toString("utf8");
    const rows = text.replace(/^﻿/, "").trim().split("\r\n").slice(2);
    expect(rows).toHaveLength(2);
    const first = rows[0].split(";");
    expect(first[0]).toBe("4,20"); // Umsatz, decimal comma
    expect(first[1]).toBe('"S"');
    expect(first[2]).toBe('"EUR"');
    expect(first).toContain("8400");
    expect(first).toContain("10000");
    expect(rows[0]).toContain('"0203"'); // Belegdatum DDMM
    expect(rows[0]).toContain("PW-2026-000001");
  });

  it("refuses rather than invent a Sachkonto", async () => {
    await expect(exportLedger(noAccounts, "datev")).rejects.toThrow(AccountingExportError);
    await expect(exportLedger(noAccounts, "datev")).rejects.toThrow(/consultant|account/i);
  });
});

describe("BMD", () => {
  it("writes a labelled NTCS import with decimal commas", async () => {
    const text = (await exportLedger(baseLedger, "bmd")).body.toString("utf8").replace(/^﻿/, "");
    const rows = text.trim().split("\r\n");
    expect(rows[0].split(";")[0]).toBe("Satzart");
    expect(rows[0]).toContain("Konto");
    expect(rows[0]).toContain("Steuer");
    expect(rows).toHaveLength(3);
    const first = rows[1].split(";");
    expect(first[0]).toBe("0");
    expect(first).toContain("8400");
    expect(rows[1]).toContain("4,20");
    expect(rows[1]).toContain("20,00");
  });

  it("refuses without the client number and the accounts", async () => {
    await expect(exportLedger(noAccounts, "bmd")).rejects.toThrow(AccountingExportError);
  });
});

describe("an empty period", () => {
  it("still produces every file, with nothing in it", async () => {
    const empty: Ledger = { ...baseLedger, lines: [], totals: { kwh: 0, gross: 0, net: 0, vat: 0, platformFee: 0, subpartnerFee: 0, partnerNet: 0 } };
    for (const format of EXPORT_FORMATS) {
      const file = await exportLedger(empty, format);
      expect(file.body.length).toBeGreaterThan(0);
    }
  });
});

// §51 — возврат ошибочного списания проходит все пять форматов как
// отрицательная строка: месяц партнёра должен сойтись с тем, что человек
// действительно получил назад.
describe("a §51 refund in every format", () => {
  const withRefund: Ledger = {
    ...baseLedger,
    lines: [
      ...baseLedger.lines,
      {
        date: new Date("2026-03-19T12:00:00Z"),
        documentNumber: "PW-2026-000003",
        correctedReceiptId: null,
        receiptId: "rf_1",
        kind: "refund",
        pointId: "p_a",
        pointName: "Point A",
        kwh: 0,
        gross: -4.2,
        net: -3.5,
        vat: -0.7,
        vatRatePct: 20,
        currency: "EUR",
        platformFee: 0,
        subpartnerFee: 0,
        partnerNet: -4.2,
      },
    ],
    totals: { kwh: 10, gross: 3, net: 2.5, vat: 0.5, platformFee: 0.15, subpartnerFee: 0.3, partnerNet: 2.55 },
  };

  it("the csv carries the line and its sign", async () => {
    const file = await exportLedger(withRefund, "csv");
    const text = file.body.toString("utf8");
    expect(text).toContain("refund");
    // Минус, а не текст: апостроф спас бы от формулы и сломал бы сумму в
    // таблице бухгалтера.
    expect(text).toContain('"-4,20"');
    expect(text).not.toContain("'-4,20");
  });

  it("every format is produced with it", async () => {
    for (const format of EXPORT_FORMATS) {
      const file = await exportLedger(withRefund, format);
      expect(file.body.length).toBeGreaterThan(0);
    }
  });
});
