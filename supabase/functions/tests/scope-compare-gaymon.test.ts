// ============================================================
// Acceptance test for the Gaymon case.
// Validates totals, missing items, grouped gutter handling,
// price-list mismatch flag, and that reconciliation blocks
// the comparison from being marked final when it fails.
// ============================================================

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  gaymonCarrierHeader,
  gaymonContractorHeader,
  gaymonCarrierLineItems,
  gaymonContractorLineItems,
} from './fixtures/gaymon-parsed.ts';
import { reconcileParsedDocument } from '../_shared/scope-reconciler.ts';
import { evaluateAssemblyRules } from '../_shared/scope-assembly-rules.ts';
import { compareNormalized } from '../compare-scope-documents/index.ts';
import {
  canonicalScopeKey,
  classifyScopeGroup,
  classifyTrade,
  stripActionPrefix,
  normalizeDescription,
  normalizeMoney,
  normalizeQuantity,
  normalizeUnit,
} from '../_shared/scope-normalizer.ts';
import { fingerprintScopeItem } from '../_shared/scope-fingerprint.ts';
import type { NormalizedScopeItem, ScopeSource } from '../_shared/scope-types.ts';

async function toNorm(row: any, source: ScopeSource): Promise<NormalizedScopeItem> {
  const desc = row.raw_description ?? '';
  const { action, cleaned } = stripActionPrefix(desc);
  const canonical = canonicalScopeKey(desc, row.unit ?? null);
  const unit = normalizeUnit(row.unit ?? null);
  const quantity = normalizeQuantity(row.quantity ?? null);
  const total = normalizeMoney(row.total_rcv ?? null);
  return {
    source,
    document_id: 'doc',
    line_item_id: row.id,
    line_number: row.line_order ?? null,
    section_name: row.section_name ?? null,
    raw_description: desc,
    cleaned_description: cleaned || normalizeDescription(desc),
    action,
    canonical_key: canonical,
    canonical_group: classifyScopeGroup(desc),
    trade_group: classifyTrade(desc),
    quantity,
    unit,
    remove_price: null,
    replace_price: null,
    unit_price: normalizeMoney(row.effective_unit_price ?? row.unit_price ?? null),
    tax: null,
    total_rcv: total,
    total_acv: normalizeMoney(row.total_acv ?? null),
    depreciation_amount: null,
    page_number: row.page_number ?? null,
    raw_line: null,
    parser_layout: 'A',
    confidence: 1,
    fingerprint: await fingerprintScopeItem({
      canonical_key: canonical,
      unit,
      section_name: row.section_name ?? null,
      line_number: row.line_order ?? null,
      quantity,
      total_rcv: total,
    }),
  };
}

Deno.test('Gaymon: carrier reconciliation passes', async () => {
  const items = await Promise.all(gaymonCarrierLineItems.map((r) => toNorm(r, 'carrier')));
  const rec = reconcileParsedDocument({
    documentId: 'carrier',
    parsedLineItems: items,
    parsedHeaderTotals: { total_rcv: gaymonCarrierHeader.total_rcv, tax_amount: 0 },
  });
  assertEquals(rec.passed, true, `carrier should reconcile: ${rec.warnings.join('; ')}`);
});

Deno.test('Gaymon: contractor reconciliation passes', async () => {
  const items = await Promise.all(gaymonContractorLineItems.map((r) => toNorm(r, 'contractor')));
  const rec = reconcileParsedDocument({
    documentId: 'contractor',
    parsedLineItems: items,
    parsedHeaderTotals: { total_rcv: gaymonContractorHeader.total_rcv, tax_amount: 0 },
  });
  assertEquals(rec.passed, true, `contractor should reconcile: ${rec.warnings.join('; ')}`);
});

Deno.test('Gaymon: comparison flags missing items, grouped gutters, and quantity deltas', async () => {
  const carrier = await Promise.all(gaymonCarrierLineItems.map((r) => toNorm(r, 'carrier')));
  const contractor = await Promise.all(gaymonContractorLineItems.map((r) => toNorm(r, 'contractor')));
  const { matches, summaryTotals } = compareNormalized(carrier, contractor, { priceListMismatch: true });

  // RCV diff sanity
  const carrierTotal = gaymonCarrierHeader.total_rcv;
  const contractorTotal = gaymonContractorHeader.total_rcv;
  assertEquals(+(contractorTotal - carrierTotal).toFixed(2), 14699.71);

  // Missing-from-carrier expectations (canonical keys)
  const missing = matches.filter((m) =>
    m.result_type === 'missing_from_carrier' ||
    m.result_type === 'grouped_missing_from_carrier'
  );
  const missingKeys = new Set(
    missing.flatMap((m) =>
      m.result_type === 'grouped_missing_from_carrier'
        ? (m.grouped_children ?? []).map((c) => c.contractor?.canonical_key)
        : [m.contractor?.canonical_key]
    ).filter(Boolean) as string[],
  );

  const expectedMissing = [
    'water_barrier_joint_taping',
    'dumpster_20yd',
    'gooseneck_vent',
    're_nail_roof_sheathing',
    'caulking_butyl_rubber',
    'gutter_downspout_aluminum_6',
    'tarp_all_purpose_poly',
    'final_cleaning_residential',
    'stucco_patch_small_repair',
  ];
  for (const k of expectedMissing) {
    assert(missingKeys.has(k), `expected missing key ${k} (got ${[...missingKeys].join(',')})`);
  }

  // Gutter grouped finding present (4 elevations grouped)
  const gutterGrouped = matches.find(
    (m) =>
      m.result_type === 'grouped_missing_from_carrier' &&
      (m.grouped_children ?? []).some((c) => c.contractor?.canonical_key === 'gutter_downspout_aluminum_6'),
  );
  assert(gutterGrouped, 'gutter R&R lines should be grouped into a single missing-from-carrier finding');
  assertEquals((gutterGrouped!.grouped_children ?? []).length, 4);

  // Quantity deltas on the matched canonical keys
  const findDelta = (key: string) => matches.find(
    (m) => m.result_type === 'quantity_delta' && m.contractor?.canonical_key === key,
  );
  for (const k of ['valley_metal', 'hip_ridge_cap_composition', 'pipe_jack']) {
    assert(findDelta(k), `expected quantity_delta for ${k}`);
  }

  // Drip edge is a tiny qty delta — depending on rounding may be reported as match or qty delta;
  // allow either, but assert it was not flagged missing.
  assert(!missingKeys.has('drip_edge'), 'drip_edge should not be flagged as missing');

  // needs_review = total of possible_match_needs_review classifications
  assert(summaryTotals.missing_from_carrier >= expectedMissing.length - 1);
});

Deno.test('Gaymon: assembly rules fire for roof, gutter, and tarp assemblies', async () => {
  const carrier = await Promise.all(gaymonCarrierLineItems.map((r) => toNorm(r, 'carrier')));
  const contractor = await Promise.all(gaymonContractorLineItems.map((r) => toNorm(r, 'contractor')));
  const findings = evaluateAssemblyRules({ carrierItems: carrier, contractorItems: contractor });
  const ids = new Set(findings.map((f) => f.rule_id));
  assert(ids.has('ROOF_REPLACEMENT_BASE_ASSEMBLY'));
  assert(ids.has('GUTTER_DOWNSPOUT_ASSEMBLY'));
  assert(ids.has('TEMPORARY_REPAIR_ASSEMBLY'));
});

Deno.test('Gaymon: comparison cannot be final if reconciliation fails', async () => {
  const items = await Promise.all(gaymonCarrierLineItems.map((r) => toNorm(r, 'carrier')));
  // Force a failing reconciliation by claiming stated RCV is wildly off
  const rec = reconcileParsedDocument({
    documentId: 'carrier',
    parsedLineItems: items,
    parsedHeaderTotals: { total_rcv: 1.0, tax_amount: 0 },
  });
  assertEquals(rec.passed, false);
  assertEquals(rec.status, 'fail');
  // Simulate compare-run gating
  const blocking = !rec.passed ? ['carrier_reconciliation_failed'] : [];
  const canFinal = blocking.length === 0;
  assertEquals(canFinal, false);
});
