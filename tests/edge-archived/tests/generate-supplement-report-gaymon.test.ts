// ============================================================
// generate-supplement-report (builder) — Gaymon-shaped fixture
// Tests pure buildSupplementReport(). No network, no AI.
// ============================================================
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSupplementReport } from "../_shared/supplement-report-builder.ts";

const CARRIER_TOTAL = 14718.16;
const CONTRACTOR_TOTAL = 29417.87;
const EXPECTED_DIFF = CONTRACTOR_TOTAL - CARRIER_TOTAL; // 14699.71

const compareRun = {
  id: "run-gaymon-1",
  carrier_total_rcv: CARRIER_TOTAL,
  contractor_total_rcv: CONTRACTOR_TOTAL,
};

const carrierDocument = {
  file_name: "carrier-gaymon.pdf",
  carrier_normalized: "State Farm",
  claim_number_detected: "GAY-001",
};
const contractorDocument = {
  file_name: "contractor-gaymon.pdf",
  carrier_normalized: "Roofer Co",
};
const carrierHeader = {
  property_address: "123 Gaymon Ln",
  price_list_name: "FLTA8X_OCT24",
  estimate_date: "2024-10-01",
  total_rcv: CARRIER_TOTAL,
};
const contractorHeader = {
  property_address: "123 Gaymon Ln",
  price_list_name: "FLTA8X_NOV24",
  estimate_date: "2024-11-15",
  total_rcv: CONTRACTOR_TOTAL,
};

// Grouped gutter parent + 2 children (children must not be double-counted)
const compareResults = [
  // Missing items
  { id: "r1", result_type: "missing_from_carrier", contractor_description: "Tarp - install (per sq ft)", contractor_quantity: 1200, unit: "SF", contractor_total_rcv: 480, total_rcv_delta: 480, included_in_supplement: true, severity: "high" },
  { id: "r2", result_type: "missing_from_carrier", contractor_description: "Gutter/Downspout - aluminum", contractor_quantity: 120, unit: "LF", contractor_total_rcv: 1080, total_rcv_delta: 1080, included_in_supplement: true, severity: "high", group_id: "g-gutter" },
  { id: "r2c1", result_type: "missing_from_carrier", contractor_description: "Gutter - elevation A", parent_result_id: "r2", contractor_total_rcv: 540 },
  { id: "r2c2", result_type: "missing_from_carrier", contractor_description: "Downspout - elevation A", parent_result_id: "r2", contractor_total_rcv: 540 },
  { id: "r3", result_type: "missing_from_carrier", contractor_description: "Dumpster - 30 yard", contractor_quantity: 1, unit: "EA", contractor_total_rcv: 650, total_rcv_delta: 650, included_in_supplement: true },
  { id: "r4", result_type: "missing_from_carrier", contractor_description: "Sheathing re-nail per IRC", contractor_quantity: 25, unit: "SQ", contractor_total_rcv: 1875, total_rcv_delta: 1875, included_in_supplement: true },
  { id: "r5", result_type: "missing_from_carrier", contractor_description: "Water barrier joint taping", contractor_quantity: 240, unit: "LF", contractor_total_rcv: 360, total_rcv_delta: 360, included_in_supplement: true },
  // Quantity delta
  { id: "r6", result_type: "quantity_delta", carrier_description: "Shingles - laminated", contractor_description: "Shingles - laminated", carrier_quantity: 22, contractor_quantity: 25, quantity_delta: 3, unit: "SQ", carrier_total_rcv: 5500, contractor_total_rcv: 6250, total_rcv_delta: 750, included_in_supplement: true },
  // Unreviewed possible match (should NOT be included by default, but generates warning)
  { id: "r7", result_type: "possible_match", carrier_description: "Drip edge", contractor_description: "Drip edge - aluminum", reviewer_status: "unreviewed", included_in_supplement: false },
  // Excluded matched item (should not appear in default report)
  { id: "r8", result_type: "matched", carrier_description: "Underlayment", contractor_description: "Underlayment", carrier_total_rcv: 300, contractor_total_rcv: 300, total_rcv_delta: 0, included_in_supplement: false },
];

Deno.test("Gaymon: top-line totals and supplement difference", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  assertEquals(built.summary.carrier_total_rcv, CARRIER_TOTAL);
  assertEquals(built.summary.contractor_total_rcv, CONTRACTOR_TOTAL);
  assertEquals(Number(built.summary.supplement_difference_rcv.toFixed(2)), Number(EXPECTED_DIFF.toFixed(2)));
});

Deno.test("Gaymon: markdown contains required sections", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  const md = built.markdown;
  assert(md.includes("## Executive Summary"));
  assert(md.includes("## Estimate Totals Comparison"));
  assert(md.includes("## Missing Items From Carrier Scope"));
  assert(md.includes("## Quantity Differences"));
  assert(md.includes("## Price List / Estimate Date Warning"));
  assert(md.includes("## Evidence / Parser Audit"));
});

Deno.test("Gaymon: report includes specific scope items", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  const md = built.markdown.toLowerCase();
  assert(md.includes("tarp"));
  assert(md.includes("gutter") || md.includes("downspout"));
  assert(md.includes("dumpster"));
  assert(md.includes("sheathing"));
  assert(md.includes("water barrier"));
});

Deno.test("Gaymon: flags FLTA8X_OCT24 vs FLTA8X_NOV24 price-list mismatch", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  const warning = built.summary.warnings.find((w) => w.includes("FLTA8X_OCT24") && w.includes("FLTA8X_NOV24"));
  assert(warning, "expected price-list mismatch warning");
});

Deno.test("Gaymon: grouped gutter children are NOT double-counted in items list", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  // children should be embedded as evidence on the parent, not as top-level items
  const gutterItems = built.items.filter((i) =>
    (i.contractor_description ?? "").toLowerCase().includes("elevation a"),
  );
  assertEquals(gutterItems.length, 0);
  const parent = built.items.find((i) => i.compare_result_id === "r2");
  assert(parent, "grouped parent should exist as an item");
  const children = (parent!.evidence as any)?.grouped_children ?? [];
  assertEquals(children.length, 2);
});

Deno.test("Gaymon: unreviewed possible matches generate a warning", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  assert(built.summary.unreviewed_count >= 1);
  assert(built.summary.warnings.some((w) => w.toLowerCase().includes("possible matches")));
});

Deno.test("Gaymon: excluded items are filtered out by default", () => {
  const built = buildSupplementReport({
    compareRun, compareResults, carrierDocument, contractorDocument, carrierHeader, contractorHeader,
  });
  const excluded = built.items.find((i) => i.compare_result_id === "r8");
  assertEquals(excluded, undefined);
});
