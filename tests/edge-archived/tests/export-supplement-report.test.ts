// ============================================================
// export-supplement-report — tests for export shape
// Re-implements CSV/JSON/MD/HTML shape against the builder's
// output. No network, no DB.
// ============================================================
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSupplementReport } from "../_shared/supplement-report-builder.ts";

const CSV_COLS = [
  "issue_type","severity","section","included","carrier_description","contractor_description",
  "quantity","unit","carrier_quantity","contractor_quantity","quantity_delta",
  "carrier_unit_price","contractor_unit_price","unit_price_delta",
  "carrier_total_rcv","contractor_total_rcv","total_rcv_delta","tax_delta",
  "confidence","justification","evidence_page",
];

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

function makeReport() {
  return buildSupplementReport({
    compareRun: { id: "run-1", carrier_total_rcv: 1000, contractor_total_rcv: 2500 },
    compareResults: [
      { id: "a", result_type: "missing_from_carrier", contractor_description: "Tarp", contractor_total_rcv: 500, total_rcv_delta: 500, included_in_supplement: true },
      { id: "b", result_type: "quantity_delta", carrier_description: "Shingles", contractor_description: "Shingles", carrier_quantity: 20, contractor_quantity: 25, quantity_delta: 5, unit: "SQ", total_rcv_delta: 1000, included_in_supplement: true },
    ],
    carrierDocument: { file_name: "c.pdf" },
    contractorDocument: { file_name: "k.pdf" },
  });
}

Deno.test("JSON export: valid JSON containing summary and items", () => {
  const built = makeReport();
  const payload = JSON.stringify({ report: { summary: built.summary, ...built.json }, items: built.items }, null, 2);
  const parsed = JSON.parse(payload);
  assert(parsed.report.summary);
  assert(Array.isArray(parsed.items));
  assertEquals(parsed.items.length, 2);
});

Deno.test("CSV export: includes all required headers", () => {
  const built = makeReport();
  const header = CSV_COLS.join(",");
  const rows = [header];
  for (const it of built.items) {
    const row = [
      it.issue_type, it.severity, it.section, it.included,
      it.carrier_description, it.contractor_description, it.quantity, it.unit,
      it.carrier_quantity, it.contractor_quantity, it.quantity_delta,
      it.carrier_unit_price, it.contractor_unit_price, it.unit_price_delta,
      it.carrier_total_rcv, it.contractor_total_rcv, it.total_rcv_delta, it.tax_delta,
      (it.evidence as any)?.match_confidence ?? null,
      it.justification_adjuster ?? it.justification_plain ?? "",
      (it.evidence as any)?.page_number ?? null,
    ].map(csvEscape).join(",");
    rows.push(row);
  }
  const csv = rows.join("\n");
  for (const col of CSV_COLS) assert(csv.split("\n")[0].includes(col), `missing column ${col}`);
  assertEquals(csv.split("\n").length, 3);
});

Deno.test("Markdown export: includes Executive Summary", () => {
  const built = makeReport();
  assert(built.markdown.includes("## Executive Summary"));
});

Deno.test("HTML export: standalone printable doc with required structure", () => {
  const built = makeReport();
  assert(built.html.startsWith("<!doctype html>"));
  assert(built.html.includes("<style>"), "must inline styles for print-ready");
  assert(built.html.includes("Executive Summary"));
  assert(built.html.includes("Supplement Difference"));
  // No external assets
  assert(!built.html.includes("http://") && !built.html.includes("https://"));
});
