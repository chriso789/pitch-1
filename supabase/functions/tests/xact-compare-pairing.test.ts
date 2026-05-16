// ============================================================
// Regression tests for the xact-compare-documents pairing engine.
// These exercise the pure logic in _shared/xact-compare-core.ts
// without needing the HTTP handler, the database, or auth.
//
// Covers:
//   1. Elevation duplicates aggregate into one weighted-average row
//   2. Paired rows always carry the parsed unit_price (never a price
//      list substitution)
//   3. Unit mismatch never causes false pairing (SQ vs LF stays split)
//   4. Tear-off vs R&R do not collide (different "remove" tag)
//   5. A non-Gaymon fixture proves the same behavior generalises
// ============================================================

import { assert, assertAlmostEquals, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  aggregateByIdentity,
  buildDiffRows,
  pairLines,
  unitsCompatible,
  type RawLine,
} from '../_shared/xact-compare-core.ts';

let _id = 0;
const id = () => `L${++_id}`;
const li = (over: Partial<RawLine>): RawLine => ({
  id: id(),
  raw_code: null,
  raw_description: '',
  raw_category: null,
  section_name: null,
  quantity: null,
  unit: null,
  unit_price: null,
  total_rcv: null,
  canonical_item_id: null,
  ...over,
});

// ---------------------------------------------------------------
// 1 + 2: Gaymon screenshot scenario — both prices preserved end-to-end
// ---------------------------------------------------------------
Deno.test('Gaymon: tear-off pair keeps both sides\' actual unit prices', () => {
  // Both rows are the "remove laminated comp shingle w/out felt" identity —
  // the canonical key + unit pairs them. The point of this test is that the
  // engine never substitutes a price-list value: parser inputs round-trip.
  const carrier = [
    li({
      raw_code: 'RFG ASBPH',
      raw_description: 'Remove Laminated - comp. shingle rfg. - w/out felt',
      quantity: 15.66, unit: 'SQ', unit_price: 78.86, total_rcv: 15.66 * 78.86,
    }),
  ];
  const company = [
    li({
      raw_code: 'RFG ASBPH',
      raw_description: 'Remove Laminated - comp. shingle rfg. - w/out felt',
      quantity: 15.43, unit: 'SQ', unit_price: 83.20, total_rcv: 15.43 * 83.20,
    }),
  ];

  const ca = aggregateByIdentity(carrier);
  const ya = aggregateByIdentity(company);
  const pr = pairLines(ca, ya);
  const rows = buildDiffRows(pr, ca, ya);

  assertEquals(pr.pairs.length, 1, 'lines should pair (same raw_code + unit)');
  assertEquals(rows.length, 1);
  const r = rows[0];
  // Parser values must round-trip unchanged — no $214.50 / $58.42 phantoms.
  assertEquals(Number(r.carrier_unit_price), 78.86);
  assertEquals(Number(r.company_unit_price), 83.20);
  assertEquals(Number(r.carrier_quantity), 15.66);
  assertEquals(Number(r.company_quantity), 15.43);
  assert(Number(r.carrier_unit_price) !== 214.50);
  assert(Number(r.company_unit_price) !== 58.42);
});

// ---------------------------------------------------------------
// 3: Four elevations of 6" gutter collapse to one weighted row
// ---------------------------------------------------------------
Deno.test('Gaymon: 4 elevation gutter rows aggregate to one weighted row', () => {
  const gutters = [
    li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'FRONT', quantity: 30, unit: 'LF', unit_price: 16, total_rcv: 480 }),
    li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'LEFT',  quantity: 30, unit: 'LF', unit_price: 16, total_rcv: 480 }),
    li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'REAR',  quantity: 30, unit: 'LF', unit_price: 16, total_rcv: 480 }),
    li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'RIGHT', quantity: 25, unit: 'LF', unit_price: 20, total_rcv: 500 }),
  ];
  const agg = aggregateByIdentity(gutters);
  assertEquals(agg.length, 1);
  const a: any = agg[0];
  assertEquals(Number(a.quantity), 115);
  assertEquals(Number(a.total_rcv), 1940);
  // Weighted avg = 1940 / 115
  assertAlmostEquals(Number(a.unit_price), 1940 / 115, 0.0001);
  assertEquals(a._aggregated_count, 4);
  assertEquals(a._aggregated_sections.length, 4);
});

// ---------------------------------------------------------------
// 4: Unit mismatch must split lines instead of pairing them
// ---------------------------------------------------------------
Deno.test('Unit mismatch: SQ vs LF on same description does not pair', () => {
  assertEquals(unitsCompatible('SQ', 'LF'), false);
  const carrier = [li({ raw_description: 'Drip edge', quantity: 4, unit: 'SQ', unit_price: 10, total_rcv: 40 })];
  const company = [li({ raw_description: 'Drip edge', quantity: 220, unit: 'LF', unit_price: 1.8, total_rcv: 396 })];
  const pr = pairLines(aggregateByIdentity(carrier), aggregateByIdentity(company));
  assertEquals(pr.pairs.length, 0, 'must NOT pair across incompatible units');
});

// ---------------------------------------------------------------
// 5: Tear-off vs R&R should not pair (different "remove" intent)
// ---------------------------------------------------------------
Deno.test('Tear-off vs full R&R on shingles stay separated', () => {
  const carrier = [
    li({ raw_description: 'Tear off comp. shingles - Laminated', quantity: 15, unit: 'SQ', unit_price: 80, total_rcv: 1200 }),
  ];
  const company = [
    li({ raw_description: 'Laminated - comp. shingle rfg. - w/out felt', quantity: 15, unit: 'SQ', unit_price: 270, total_rcv: 4050 }),
  ];
  const pr = pairLines(aggregateByIdentity(carrier), aggregateByIdentity(company));
  // descKey appends ' rm' tag only on the carrier side → keys differ → no pair.
  assertEquals(pr.pairs.length, 0, 'remove-only must not pair with install/R&R line');
});

// ---------------------------------------------------------------
// 6: Generalisation — synthetic siding project (non-Gaymon)
// Same engine must still: aggregate, preserve prices, gate by unit.
// ---------------------------------------------------------------
Deno.test('Synthetic siding project: aggregation + price preservation generalises', () => {
  const carrier = [
    li({ raw_code: 'SDG VINYL', raw_description: 'R&R Siding - vinyl', quantity: 1200, unit: 'SF', unit_price: 5.50, total_rcv: 6600 }),
    li({ raw_code: 'WDW WRAP',  raw_description: 'Window wrap - aluminum',  quantity: 14, unit: 'EA', unit_price: 65, total_rcv: 910 }),
  ];
  const company = [
    // Elevation breakouts of vinyl siding — must collapse.
    li({ raw_code: 'SDG VINYL', section_name: 'FRONT', raw_description: 'R&R Siding - vinyl', quantity: 400, unit: 'SF', unit_price: 6.00, total_rcv: 2400 }),
    li({ raw_code: 'SDG VINYL', section_name: 'LEFT',  raw_description: 'R&R Siding - vinyl', quantity: 350, unit: 'SF', unit_price: 6.00, total_rcv: 2100 }),
    li({ raw_code: 'SDG VINYL', section_name: 'REAR',  raw_description: 'R&R Siding - vinyl', quantity: 350, unit: 'SF', unit_price: 6.20, total_rcv: 2170 }),
    li({ raw_code: 'WDW WRAP',  raw_description: 'Window wrap - aluminum',  quantity: 18, unit: 'EA', unit_price: 72, total_rcv: 1296 }),
    li({ raw_code: 'GUT 6AL',   raw_description: 'R&R Gutter - aluminum 6"', quantity: 180, unit: 'LF', unit_price: 9.50, total_rcv: 1710 }),
  ];

  const ca = aggregateByIdentity(carrier);
  const ya = aggregateByIdentity(company);
  // Company side: 3 siding rows → 1 aggregate; window wrap stays single; gutter stays single → 3 rows.
  assertEquals(ya.length, 3);
  const sidingAgg: any = ya.find(l => l.raw_code === 'SDG VINYL');
  assertEquals(Number(sidingAgg.quantity), 1100);
  assertAlmostEquals(Number(sidingAgg.unit_price), 6670 / 1100, 0.0001);
  assertEquals(sidingAgg._aggregated_count, 3);

  const pr = pairLines(ca, ya);
  const rows = buildDiffRows(pr, ca, ya);

  // Siding row paired & flagged (qty + price both change)
  const siding = rows.find(r => r.carrier_code === 'SDG VINYL' && r.company_code === 'SDG VINYL');
  assert(siding, 'siding lines must pair on raw_code+unit');
  assertEquals(Number(siding!.carrier_unit_price), 5.50, 'carrier unit price untouched');
  // Company unit price is the weighted aggregate, not any single elevation row.
  assertAlmostEquals(Number(siding!.company_unit_price), 6670 / 1100, 0.0001);
  // Children trail must be present so the UI can expand.
  assertEquals(siding!.grouped_children?.length, 3);

  // Window wrap is a price/qty change
  const wrap = rows.find(r => r.carrier_code === 'WDW WRAP');
  assert(wrap, 'window wrap should pair');
  assertEquals(Number(wrap!.carrier_unit_price), 65);
  assertEquals(Number(wrap!.company_unit_price), 72);

  // Gutter exists only on company side → 'added'
  const gut = rows.find(r => r.company_code === 'GUT 6AL');
  assert(gut, 'company-only gutter must surface as added');
  assertEquals(gut!.change_type, 'added');
  assertEquals(gut!.carrier_unit_price ?? null, null);
});

// ---------------------------------------------------------------
// 7: No row may invent a unit price absent from both sides.
// ---------------------------------------------------------------
Deno.test('No diff row contains a unit price absent from parsed input', () => {
  const carrier = [li({ raw_code: 'RFG ASBPH', raw_description: 'Laminated', quantity: 10, unit: 'SQ', unit_price: 78.86, total_rcv: 788.6 })];
  const company = [li({ raw_code: 'RFG ASBPH', raw_description: 'Laminated', quantity: 12, unit: 'SQ', unit_price: 83.20, total_rcv: 998.4 })];
  const ca = aggregateByIdentity(carrier);
  const ya = aggregateByIdentity(company);
  const pr = pairLines(ca, ya);
  const rows = buildDiffRows(pr, ca, ya);
  const seen = new Set<number>();
  for (const r of rows) {
    if (r.carrier_unit_price != null) seen.add(Number(r.carrier_unit_price));
    if (r.company_unit_price != null) seen.add(Number(r.company_unit_price));
  }
  for (const v of seen) {
    assert(
      [78.86, 83.20].includes(v),
      `unit price ${v} appeared but is not present in either parsed source`,
    );
  }
});
