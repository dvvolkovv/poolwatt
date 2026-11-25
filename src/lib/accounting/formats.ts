// The list of formats §46 names, and the error that means "the partner has
// not told us something only they know".
//
// Kept apart from `export.ts` on purpose: that module pulls in exceljs and
// pdfkit, and a page that only wants to label five buttons must not drag a
// PDF engine into the browser bundle's server half.

export class AccountingExportError extends Error {}

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf", "datev", "bmd"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
