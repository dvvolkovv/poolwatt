// US-46 — "Выгрузка за выбранный период во всех форматах". Five renderers over
// the neutral lines `ledger.ts` produces.
//
// CSV and Excel are for people, PDF is for the file somebody signs, DATEV and
// BMD are for the accountant's software. The two bookkeeping formats need
// account numbers the partner must supply: Beraternummer, Mandantennummer, a
// revenue account and a counter account. We refuse without them. A posting on
// a made-up Sachkonto looks right, imports cleanly and takes an accountant a
// day to unpick — a missing file takes them a minute to ask about.

import type { Ledger, LedgerLine } from "./ledger";
import { AccountingExportError, EXPORT_FORMATS, type ExportFormat } from "./formats";

export { AccountingExportError, EXPORT_FORMATS, type ExportFormat };

export interface ExportedFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

const BOM = "﻿";
const SEP = ";";
const EOL = "\r\n";

/** European decimal comma, two places — what DATEV, BMD and Excel expect. */
function money(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function kwh(value: number): string {
  return value.toFixed(3).replace(".", ",");
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * A cell that starts with =, +, - or @ is a formula to Excel and to half the
 * spreadsheet tools in the world. A point named by a partner is untrusted
 * input, so it is prefixed before it can be executed on the accountant's
 * machine.
 */
function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "network";
}

function filenameFor(ledger: Ledger, ext: string): string {
  // The period is half-open; the name shows the last day inside it.
  const lastDay = new Date(ledger.to.getTime() - 24 * 60 * 60 * 1000);
  return `poolwatt-${isoDate(ledger.from)}-${isoDate(lastDay)}-${slug(ledger.network.displayName)}.${ext}`;
}

export async function exportLedger(
  ledger: Ledger,
  format: ExportFormat,
): Promise<ExportedFile> {
  switch (format) {
    case "csv":
      return {
        filename: filenameFor(ledger, "csv"),
        contentType: "text/csv; charset=utf-8",
        body: Buffer.from(renderCsv(ledger), "utf8"),
      };
    case "xlsx":
      return {
        filename: filenameFor(ledger, "xlsx"),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: await renderXlsx(ledger),
      };
    case "pdf": {
      // pdfkit reads font files when it loads, which a bundler cannot do at
      // build time — so it is pulled in only when a PDF is actually asked for.
      const { renderLedgerPdf } = await import("./export-pdf");
      return {
        filename: filenameFor(ledger, "pdf"),
        contentType: "application/pdf",
        body: await renderLedgerPdf(ledger),
      };
    }
    case "datev":
      return {
        filename: filenameFor(ledger, "datev.csv"),
        contentType: "text/csv; charset=utf-8",
        body: Buffer.from(renderDatev(ledger), "utf8"),
      };
    case "bmd":
      return {
        filename: filenameFor(ledger, "bmd.csv"),
        contentType: "text/csv; charset=utf-8",
        body: Buffer.from(renderBmd(ledger), "utf8"),
      };
    default:
      throw new AccountingExportError(`Unknown export format: ${String(format)}`);
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────

const CSV_HEADER = [
  "date",
  "document",
  "kind",
  "point",
  "kwh",
  "net",
  "vat",
  "vatRate",
  "gross",
  "currency",
  "receiptId",
];

export function renderCsv(ledger: Ledger): string {
  const rows = [CSV_HEADER.join(SEP)];
  for (const l of ledger.lines) {
    rows.push(
      [
        isoDate(l.date),
        l.documentNumber,
        l.kind,
        l.pointName ?? "",
        kwh(l.kwh),
        money(l.net),
        money(l.vat),
        l.vatRatePct != null ? money(l.vatRatePct) : "",
        money(l.gross),
        l.currency,
        l.receiptId,
      ]
        .map(csvCell)
        .join(SEP),
    );
  }
  rows.push(
    [
      "",
      "TOTAL",
      "",
      "",
      kwh(ledger.totals.kwh),
      money(ledger.totals.net),
      money(ledger.totals.vat),
      "",
      money(ledger.totals.gross),
      ledger.currency,
      "",
    ]
      .map(csvCell)
      .join(SEP),
  );
  return BOM + rows.join(EOL) + EOL;
}

// ── Excel ─────────────────────────────────────────────────────────────────

async function renderXlsx(ledger: Ledger): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Poolwatt";
  wb.created = new Date();
  const sheet = wb.addWorksheet(isoDate(ledger.from).slice(0, 7));

  sheet.addRow([ledger.network.displayName]).font = { bold: true, size: 14 };
  sheet.addRow([ledger.network.legalName ?? ""]);
  sheet.addRow([ledger.network.address ?? ""]);
  sheet.addRow([
    ledger.network.vatNumber ? `VAT ${ledger.network.vatNumber}` : "",
    ledger.network.regNumber ? `Reg ${ledger.network.regNumber}` : "",
  ]);
  sheet.addRow([`${isoDate(ledger.from)} — ${isoDate(new Date(ledger.to.getTime() - 86_400_000))}`]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Date",
    "Document",
    "Kind",
    "Point",
    "kWh",
    "Net",
    "VAT",
    "VAT %",
    "Gross",
    "Currency",
  ]);
  header.font = { bold: true };

  for (const l of ledger.lines) {
    sheet.addRow([
      isoDate(l.date),
      l.documentNumber,
      l.kind,
      l.pointName ?? "",
      l.kwh,
      l.net,
      l.vat,
      l.vatRatePct,
      l.gross,
      l.currency,
    ]);
  }

  const totals = sheet.addRow([
    "",
    "TOTAL",
    "",
    "",
    ledger.totals.kwh,
    ledger.totals.net,
    ledger.totals.vat,
    "",
    ledger.totals.gross,
    ledger.currency,
  ]);
  totals.font = { bold: true };

  for (const col of [5, 6, 7, 9]) sheet.getColumn(col).numFmt = "#,##0.00";
  sheet.getColumn(5).numFmt = "#,##0.000";
  sheet.columns.forEach((c) => {
    c.width = 16;
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// ── DATEV ─────────────────────────────────────────────────────────────────

const DATEV_COLUMNS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
];

function datevStamp(at: Date): string {
  return (
    at.getUTCFullYear().toString() +
    String(at.getUTCMonth() + 1).padStart(2, "0") +
    String(at.getUTCDate()).padStart(2, "0") +
    String(at.getUTCHours()).padStart(2, "0") +
    String(at.getUTCMinutes()).padStart(2, "0") +
    String(at.getUTCSeconds()).padStart(2, "0") +
    "000"
  );
}

function yyyymmdd(at: Date): string {
  return isoDate(at).replace(/-/g, "");
}

export function renderDatev(ledger: Ledger, now = new Date()): string {
  const a = ledger.accounts;
  const missing: string[] = [];
  if (!a.datevConsultantNo) missing.push("DATEV consultant number");
  if (!a.datevClientNo) missing.push("DATEV client number");
  if (!a.revenueAccount) missing.push("revenue account");
  if (!a.counterAccount) missing.push("counter account");
  if (missing.length > 0) {
    throw new AccountingExportError(
      `DATEV export needs the partner's own ${missing.join(", ")}. Fill them in the network's accounting settings — Poolwatt does not invent account numbers.`,
    );
  }

  const fiscalStart = new Date(
    Date.UTC(ledger.from.getUTCFullYear(), (a.fiscalYearStart || 1) - 1, 1),
  );
  const lastDay = new Date(ledger.to.getTime() - 86_400_000);

  // EXTF header, format 700 "Buchungsstapel" (category 21).
  const header = [
    '"EXTF"',
    "700",
    "21",
    '"Buchungsstapel"',
    "13",
    datevStamp(now),
    "",
    '"RE"',
    '"Poolwatt"',
    '""',
    a.datevConsultantNo,
    a.datevClientNo,
    yyyymmdd(fiscalStart),
    "4",
    yyyymmdd(ledger.from),
    yyyymmdd(lastDay),
    `"Poolwatt ${isoDate(ledger.from).slice(0, 7)}"`,
    '""',
    "1",
    "0",
    "0",
    `"${ledger.currency}"`,
    "",
    "",
    "",
    "",
    "",
    '""',
    '""',
    '""',
    '""',
  ].join(SEP);

  const rows = [header, DATEV_COLUMNS.join(SEP)];
  for (const l of ledger.lines) {
    rows.push(
      [
        money(l.gross),
        '"S"', // revenue is a debit on the counter account
        `"${ledger.currency}"`,
        "",
        "",
        "",
        a.revenueAccount,
        a.counterAccount,
        "",
        // Belegdatum is DDMM in EXTF, the fiscal year comes from the header.
        `"${String(l.date.getUTCDate()).padStart(2, "0")}${String(l.date.getUTCMonth() + 1).padStart(2, "0")}"`,
        `"${l.documentNumber}"`,
        "",
        "",
        `"${datevText(l)}"`,
      ].join(SEP),
    );
  }
  return BOM + rows.join(EOL) + EOL;
}

function datevText(l: LedgerLine): string {
  const what = l.kind === "charge" ? "Ladevorgang" : l.kind === "reservation.no_show" ? "Reservierung" : "Umsatz";
  // DATEV truncates Buchungstext at 60 characters; cut it ourselves so the
  // accountant sees the same text we meant to write.
  return `${what} ${l.pointName ?? ""}`.replace(/["\r\n;]/g, " ").trim().slice(0, 60);
}

// ── BMD ───────────────────────────────────────────────────────────────────

const BMD_COLUMNS = [
  "Satzart",
  "Konto",
  "Gegenkonto",
  "Buchdatum",
  "Belegdatum",
  "Belegnr",
  "Steuer",
  "Betrag",
  "Waehrung",
  "Text",
  "Mandant",
];

export function renderBmd(ledger: Ledger): string {
  const a = ledger.accounts;
  const missing: string[] = [];
  if (!a.bmdClientNo) missing.push("BMD client number");
  if (!a.revenueAccount) missing.push("revenue account");
  if (!a.counterAccount) missing.push("counter account");
  if (missing.length > 0) {
    throw new AccountingExportError(
      `BMD export needs the partner's own ${missing.join(", ")}. Fill them in the network's accounting settings — Poolwatt does not invent account numbers.`,
    );
  }

  const rows = [BMD_COLUMNS.join(SEP)];
  for (const l of ledger.lines) {
    rows.push(
      [
        "0",
        a.counterAccount,
        a.revenueAccount,
        isoDate(l.date),
        isoDate(l.date),
        l.documentNumber,
        l.vatRatePct != null ? money(l.vatRatePct) : "",
        money(l.gross),
        l.currency,
        datevText(l),
        a.bmdClientNo,
      ]
        .map((v) => String(v).replace(/[;\r\n]/g, " "))
        .join(SEP),
    );
  }
  return BOM + rows.join(EOL) + EOL;
}
