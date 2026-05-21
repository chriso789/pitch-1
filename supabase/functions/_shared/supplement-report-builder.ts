// ============================================================
// Supplement Report Builder
// Pure function: turns compare-run rows into a structured report
// (summary, items, markdown, html, json). No DB / IO inside.
// ============================================================

export interface BuildReportParams {
  compareRun: any;
  compareResults: any[];
  carrierDocument?: any;
  contractorDocument?: any;
  carrierHeader?: any;
  contractorHeader?: any;
  options?: {
    includeReviewedOnly?: boolean;
    includeExcluded?: boolean;
    groupBySection?: boolean;
    groupByIssueType?: boolean;
  };
}

export interface BuiltReportItem {
  item_order: number;
  section: string;
  issue_type: string;
  severity: string;
  included: boolean;
  compare_result_id: string | null;
  carrier_description: string | null;
  contractor_description: string | null;
  description_for_report: string;
  quantity: number | null;
  unit: string | null;
  carrier_quantity: number | null;
  contractor_quantity: number | null;
  quantity_delta: number | null;
  carrier_unit_price: number | null;
  contractor_unit_price: number | null;
  unit_price_delta: number | null;
  carrier_total_rcv: number | null;
  contractor_total_rcv: number | null;
  total_rcv_delta: number | null;
  tax_delta: number | null;
  justification_plain: string | null;
  justification_adjuster: string | null;
  justification_contractor: string | null;
  evidence: Record<string, unknown>;
  reviewer_note: string | null;
  match_confidence: number | null;
  is_grouped_parent: boolean;
}

export interface BuiltReportSummary {
  property_address: string | null;
  insured_name: string | null;
  claim_number: string | null;
  carrier_name: string | null;
  contractor_name: string | null;
  carrier_total_rcv: number;
  contractor_total_rcv: number;
  supplement_difference_rcv: number;
  included_items_total: number;
  excluded_items_total: number;
  missing_items_total: number;
  quantity_delta_total: number;
  price_delta_total: number;
  tax_delta_total: number;
  included_count: number;
  excluded_count: number;
  unreviewed_count: number;
  warnings: string[];
}

export interface BuiltReport {
  summary: BuiltReportSummary;
  items: BuiltReportItem[];
  markdown: string;
  html: string;
  json: Record<string, unknown>;
}

const DISCLAIMER =
  'This report is a scope comparison aid generated from parsed estimate documents. Final claim submission should be reviewed by a licensed contractor or claim professional.';

const SECTION_ORDER = [
  'Executive Summary',
  'Estimate Totals Comparison',
  'Price List / Estimate Date Warning',
  'Missing Items From Carrier Scope',
  'Quantity Differences',
  'Unit Price Differences',
  'Grouped Elevation / Assembly Differences',
  'Tax / Total Differences',
  'Possible Matches Requiring Review',
  'Matched Items Not Included In Supplement',
  'Evidence / Parser Audit',
];

const ISSUE_TO_SECTION: Record<string, string> = {
  missing_from_carrier: 'Missing Items From Carrier Scope',
  missing_from_contractor: 'Matched Items Not Included In Supplement',
  quantity_delta: 'Quantity Differences',
  price_delta: 'Unit Price Differences',
  grouped_delta: 'Grouped Elevation / Assembly Differences',
  assembly_finding: 'Grouped Elevation / Assembly Differences',
  possible_match: 'Possible Matches Requiring Review',
  matched: 'Matched Items Not Included In Supplement',
  tax_delta: 'Tax / Total Differences',
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const money = (n: number | null | undefined): string => {
  const v = num(n);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );

function deriveJustification(r: any): {
  plain: string | null;
  adjuster: string | null;
  contractor: string | null;
} {
  const j = r?.justification;
  if (j && typeof j === 'object') {
    return {
      plain: j.plain_english ?? j.plain ?? null,
      adjuster: j.adjuster_facing ?? j.adjuster ?? null,
      contractor: j.contractor_facing ?? j.contractor ?? null,
    };
  }
  if (typeof r?.explanation === 'string') {
    return { plain: r.explanation, adjuster: r.explanation, contractor: r.explanation };
  }
  return { plain: null, adjuster: null, contractor: null };
}

function descriptionForReport(r: any): string {
  if (r?.reviewer_note) return String(r.reviewer_note);
  return (
    r?.contractor_description ||
    r?.carrier_description ||
    r?.normalized_key ||
    r?.canonical_group ||
    'Scope item'
  );
}

function isGroupedParent(r: any): boolean {
  return !!r?.group_id && !r?.parent_result_id;
}

function isGroupedChild(r: any): boolean {
  return !!r?.parent_result_id;
}

export function buildSupplementReport(params: BuildReportParams): BuiltReport {
  const {
    compareRun,
    compareResults,
    carrierDocument,
    contractorDocument,
    carrierHeader,
    contractorHeader,
    options = {},
  } = params;

  const includeReviewedOnly = !!options.includeReviewedOnly;
  const includeExcluded = !!options.includeExcluded;

  // ---------- Filter ----------
  const eligible = (compareResults || []).filter((r) => {
    if (isGroupedChild(r)) return false; // children appear as evidence on parent
    if (!includeExcluded && r.included_in_supplement === false) return false;
    if (includeReviewedOnly && r.reviewer_status !== 'reviewed') return false;
    return true;
  });

  // ---------- Build items ----------
  const items: BuiltReportItem[] = eligible.map((r, idx) => {
    const j = deriveJustification(r);
    const section = ISSUE_TO_SECTION[r.result_type] ?? 'Evidence / Parser Audit';
    // Collect grouped children as evidence
    const childRows = (compareResults || []).filter(
      (c) => c.parent_result_id === r.id,
    );
    const evidence = {
      ...(r.evidence && typeof r.evidence === 'object' ? r.evidence : {}),
      match_method: r.match_method ?? null,
      match_confidence: numOrNull(r.match_confidence),
      grouped_children: childRows.map((c) => ({
        id: c.id,
        carrier_description: c.carrier_description,
        contractor_description: c.contractor_description,
        carrier_quantity: numOrNull(c.carrier_quantity),
        contractor_quantity: numOrNull(c.contractor_quantity),
        carrier_total_rcv: numOrNull(c.carrier_total_rcv),
        contractor_total_rcv: numOrNull(c.contractor_total_rcv),
      })),
    };

    return {
      item_order: idx,
      section,
      issue_type: r.result_type,
      severity: r.severity ?? 'info',
      included: r.included_in_supplement !== false,
      compare_result_id: r.id ?? null,
      carrier_description: r.carrier_description ?? null,
      contractor_description: r.contractor_description ?? null,
      description_for_report: descriptionForReport(r),
      quantity: numOrNull(r.contractor_quantity ?? r.carrier_quantity),
      unit: r.unit ?? null,
      carrier_quantity: numOrNull(r.carrier_quantity),
      contractor_quantity: numOrNull(r.contractor_quantity),
      quantity_delta: numOrNull(r.quantity_delta),
      carrier_unit_price: numOrNull(r.carrier_unit_price),
      contractor_unit_price: numOrNull(r.contractor_unit_price),
      unit_price_delta: numOrNull(r.unit_price_delta),
      carrier_total_rcv: numOrNull(r.carrier_total_rcv),
      contractor_total_rcv: numOrNull(r.contractor_total_rcv),
      total_rcv_delta: numOrNull(r.total_rcv_delta),
      tax_delta: numOrNull(r.tax_delta),
      justification_plain: j.plain,
      justification_adjuster: j.adjuster,
      justification_contractor: j.contractor,
      evidence,
      reviewer_note: r.reviewer_note ?? null,
      match_confidence: numOrNull(r.match_confidence),
      is_grouped_parent: isGroupedParent(r),
    };
  });

  // ---------- Summary totals ----------
  const carrierTotal = num(
    compareRun?.carrier_total_rcv ?? carrierHeader?.total_rcv,
  );
  const contractorTotal = num(
    compareRun?.contractor_total_rcv ?? contractorHeader?.total_rcv,
  );

  const includedItems = items.filter((i) => i.included);
  const excludedItems = items.filter((i) => !i.included);
  const includedTotal = includedItems.reduce(
    (s, i) => s + num(i.total_rcv_delta),
    0,
  );
  const excludedTotal = excludedItems.reduce(
    (s, i) => s + num(i.total_rcv_delta),
    0,
  );
  const missingTotal = includedItems
    .filter((i) => i.issue_type === 'missing_from_carrier')
    .reduce((s, i) => s + num(i.contractor_total_rcv), 0);
  const qtyDeltaTotal = includedItems
    .filter((i) => i.issue_type === 'quantity_delta')
    .reduce((s, i) => s + num(i.total_rcv_delta), 0);
  const priceDeltaTotal = includedItems
    .filter((i) => i.issue_type === 'price_delta')
    .reduce((s, i) => s + num(i.total_rcv_delta), 0);
  const taxDeltaTotal = items.reduce((s, i) => s + num(i.tax_delta), 0);

  // ---------- Warnings ----------
  const warnings: string[] = [];
  const carrierPL = carrierHeader?.price_list_name;
  const contractorPL = contractorHeader?.price_list_name;
  if (carrierPL && contractorPL && carrierPL !== contractorPL) {
    warnings.push(
      `Price list mismatch: carrier=${carrierPL} vs contractor=${contractorPL}`,
    );
  }
  const carrierED = carrierHeader?.estimate_date;
  const contractorED = contractorHeader?.estimate_date;
  if (carrierED && contractorED && carrierED !== contractorED) {
    warnings.push(
      `Estimate date mismatch: carrier=${carrierED} vs contractor=${contractorED}`,
    );
  }
  const unreviewedPossible = (compareResults || []).filter(
    (r) =>
      r.result_type === 'possible_match' &&
      (r.reviewer_status ?? 'unreviewed') !== 'reviewed',
  ).length;
  if (unreviewedPossible > 0) {
    warnings.push(
      `${unreviewedPossible} possible matches still require reviewer attention.`,
    );
  }

  const summary: BuiltReportSummary = {
    property_address:
      carrierHeader?.property_address ?? contractorHeader?.property_address ?? null,
    insured_name: null,
    claim_number: carrierDocument?.claim_number_detected ?? null,
    carrier_name: carrierDocument?.carrier_normalized ?? carrierDocument?.carrier_name ?? null,
    contractor_name: contractorDocument?.carrier_normalized ?? null,
    carrier_total_rcv: carrierTotal,
    contractor_total_rcv: contractorTotal,
    supplement_difference_rcv: contractorTotal - carrierTotal,
    included_items_total: includedTotal,
    excluded_items_total: excludedTotal,
    missing_items_total: missingTotal,
    quantity_delta_total: qtyDeltaTotal,
    price_delta_total: priceDeltaTotal,
    tax_delta_total: taxDeltaTotal,
    included_count: includedItems.length,
    excluded_count: excludedItems.length,
    unreviewed_count: unreviewedPossible,
    warnings,
  };

  // ---------- Markdown ----------
  const md: string[] = [];
  md.push(`# Supplement Scope Difference Report`);
  md.push('');
  md.push(`_Generated ${new Date().toISOString().slice(0, 10)}_`);
  md.push('');
  md.push('## Executive Summary');
  if (summary.carrier_name) md.push(`- **Carrier:** ${summary.carrier_name}`);
  if (summary.contractor_name) md.push(`- **Contractor:** ${summary.contractor_name}`);
  if (summary.claim_number) md.push(`- **Claim #:** ${summary.claim_number}`);
  if (summary.property_address) md.push(`- **Property:** ${summary.property_address}`);
  md.push('');
  md.push('## Estimate Totals Comparison');
  md.push(`- Carrier RCV: ${money(summary.carrier_total_rcv)}`);
  md.push(`- Contractor RCV: ${money(summary.contractor_total_rcv)}`);
  md.push(`- **Supplement Difference: ${money(summary.supplement_difference_rcv)}**`);
  md.push(`- Included items total (delta): ${money(summary.included_items_total)}`);
  md.push(`- Missing items total: ${money(summary.missing_items_total)}`);
  md.push(`- Quantity delta total: ${money(summary.quantity_delta_total)}`);
  md.push(`- Price delta total: ${money(summary.price_delta_total)}`);
  md.push('');
  if (warnings.length) {
    md.push('## Price List / Estimate Date Warning');
    for (const w of warnings) md.push(`- ⚠️ ${w}`);
    md.push('');
  }

  const itemsBySection = new Map<string, BuiltReportItem[]>();
  for (const it of items) {
    const arr = itemsBySection.get(it.section) ?? [];
    arr.push(it);
    itemsBySection.set(it.section, arr);
  }
  for (const section of SECTION_ORDER) {
    const arr = itemsBySection.get(section);
    if (!arr || arr.length === 0) continue;
    if (section === 'Executive Summary' || section === 'Estimate Totals Comparison' || section === 'Price List / Estimate Date Warning') continue;
    md.push(`## ${section}`);
    for (const it of arr) {
      const headline = `**${it.description_for_report}** — ${money(it.total_rcv_delta)}`;
      md.push(`- ${headline}`);
      if (it.carrier_quantity != null || it.contractor_quantity != null) {
        md.push(
          `  - Qty: carrier ${it.carrier_quantity ?? '—'} vs contractor ${it.contractor_quantity ?? '—'} ${it.unit ?? ''} (Δ ${it.quantity_delta ?? 0})`,
        );
      }
      if (it.carrier_unit_price != null || it.contractor_unit_price != null) {
        md.push(
          `  - Unit price: ${money(it.carrier_unit_price)} → ${money(it.contractor_unit_price)} (Δ ${money(it.unit_price_delta)})`,
        );
      }
      if (it.justification_adjuster) {
        md.push(`  - _${it.justification_adjuster}_`);
      }
      const ev = it.evidence as any;
      if (ev?.grouped_children?.length) {
        md.push(`  - Grouped children (${ev.grouped_children.length}):`);
        for (const c of ev.grouped_children) {
          md.push(`    - ${c.contractor_description || c.carrier_description}`);
        }
      }
      if (it.match_confidence != null) {
        md.push(`  - confidence: ${(it.match_confidence * 100).toFixed(0)}%`);
      }
    }
    md.push('');
  }
  md.push('## Evidence / Parser Audit');
  md.push(`- Carrier doc: ${carrierDocument?.file_name ?? '—'}`);
  md.push(`- Contractor doc: ${contractorDocument?.file_name ?? '—'}`);
  md.push(`- Compare run id: ${compareRun?.id ?? '—'}`);
  md.push('');
  md.push(`---`);
  md.push(`_${DISCLAIMER}_`);
  const markdown = md.join('\n');

  // ---------- HTML ----------
  const htmlParts: string[] = [];
  htmlParts.push(`<!doctype html><html><head><meta charset="utf-8"><title>Supplement Report</title>`);
  htmlParts.push(`<style>body{font-family:system-ui,sans-serif;max-width:880px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:24px}h2{margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}.warn{background:#fff7e6;border-left:4px solid #f59e0b;padding:8px;margin:8px 0}.muted{color:#666;font-size:12px}</style></head><body>`);
  htmlParts.push(`<h1>${escapeHtml('Supplement Scope Difference Report')}</h1>`);
  htmlParts.push(`<p class="muted">Generated ${escapeHtml(new Date().toISOString().slice(0, 10))}</p>`);
  htmlParts.push(`<h2>Executive Summary</h2><table>`);
  htmlParts.push(`<tr><th>Carrier RCV</th><td>${money(summary.carrier_total_rcv)}</td></tr>`);
  htmlParts.push(`<tr><th>Contractor RCV</th><td>${money(summary.contractor_total_rcv)}</td></tr>`);
  htmlParts.push(`<tr><th>Supplement Difference</th><td><strong>${money(summary.supplement_difference_rcv)}</strong></td></tr>`);
  htmlParts.push(`<tr><th>Included Items Δ</th><td>${money(summary.included_items_total)}</td></tr>`);
  htmlParts.push(`<tr><th>Missing Items Total</th><td>${money(summary.missing_items_total)}</td></tr>`);
  htmlParts.push(`</table>`);
  if (warnings.length) {
    htmlParts.push(`<h2>Price List / Estimate Date Warning</h2>`);
    for (const w of warnings) htmlParts.push(`<div class="warn">${escapeHtml(w)}</div>`);
  }
  for (const section of SECTION_ORDER) {
    const arr = itemsBySection.get(section);
    if (!arr || arr.length === 0) continue;
    if (section === 'Executive Summary' || section === 'Estimate Totals Comparison' || section === 'Price List / Estimate Date Warning') continue;
    htmlParts.push(`<h2>${escapeHtml(section)}</h2><table><thead><tr><th>Item</th><th>Carrier</th><th>Contractor</th><th>Δ RCV</th><th>Confidence</th></tr></thead><tbody>`);
    for (const it of arr) {
      htmlParts.push(
        `<tr><td><strong>${escapeHtml(it.description_for_report)}</strong>${it.justification_adjuster ? `<br/><span class="muted">${escapeHtml(it.justification_adjuster)}</span>` : ''}</td><td>${it.carrier_quantity ?? '—'} ${escapeHtml(it.unit ?? '')} @ ${money(it.carrier_unit_price)}</td><td>${it.contractor_quantity ?? '—'} ${escapeHtml(it.unit ?? '')} @ ${money(it.contractor_unit_price)}</td><td>${money(it.total_rcv_delta)}</td><td>${it.match_confidence != null ? (it.match_confidence * 100).toFixed(0) + '%' : '—'}</td></tr>`,
      );
    }
    htmlParts.push(`</tbody></table>`);
  }
  htmlParts.push(`<hr/><p class="muted">${escapeHtml(DISCLAIMER)}</p></body></html>`);
  const html = htmlParts.join('');

  const json = {
    summary,
    items,
    sections: SECTION_ORDER,
    disclaimer: DISCLAIMER,
    generated_at: new Date().toISOString(),
  };

  return { summary, items, markdown, html, json };
}

export const SUPPLEMENT_REPORT_DISCLAIMER = DISCLAIMER;
export const SUPPLEMENT_REPORT_SECTIONS = SECTION_ORDER;
