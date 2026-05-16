// ============================================================
// Supplement justification builder.
// Turns a ScopeCompareIssue (ScopeMatch | AssemblyFinding) into
// four narratives: plain English, contractor-facing,
// adjuster-facing, internal reviewer.
// ============================================================

import type {
  AssemblyFinding,
  ScopeMatch,
  SupplementJustification,
  NormalizedScopeItem,
} from './scope-types.ts';

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '$0.00';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function qty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function pickDesc(item: NormalizedScopeItem | null | undefined): string {
  if (!item) return 'item';
  return item.raw_description || item.cleaned_description || item.canonical_key;
}

function section(item: NormalizedScopeItem | null | undefined): string {
  return item?.section_name ? item.section_name : 'the affected area';
}

export function buildJustification(
  issue: ScopeMatch | (AssemblyFinding & { kind: 'assembly_finding' }),
): SupplementJustification {
  // Assembly finding
  if ('kind' in issue && issue.kind === 'assembly_finding') {
    const f = issue;
    const missing = [...f.missing_on_carrier, ...f.missing_on_contractor].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    const missingTxt = missing.length ? missing.join(', ') : 'related components';
    return {
      plain_english: `${f.explanation} Detected missing related item(s): ${missingTxt}.`,
      contractor_facing: `The carrier scope is missing components that typically accompany this work: ${missingTxt}. Review the related-assembly checklist and supplement any items that are required for the system to be installed to code or manufacturer specification.`,
      adjuster_facing: `Please review whether the following related-assembly components were considered with the underlying scope: ${missingTxt}. ${f.explanation}`,
      internal_reviewer: `[${f.rule_id}] severity=${f.severity}. Missing on carrier: ${
        f.missing_on_carrier.join(', ') || 'none'
      }. Missing on contractor: ${f.missing_on_contractor.join(', ') || 'none'}. Trade=${
        f.trade_group
      }. Triggered by: ${f.triggered_by.join(',') || 'unknown'}.`,
    };
  }

  // Match-based issues
  const m = issue as ScopeMatch;
  switch (m.result_type) {
    case 'missing_from_carrier': {
      const c = m.contractor!;
      const total = c.total_rcv;
      return {
        plain_english: `The contractor scope includes ${pickDesc(c)} in ${section(c)} for ${qty(
          c.quantity,
        )} ${c.unit ?? ''} with a total RCV of ${money(total)}. No matching allowance was found in the carrier scope. This item should be reviewed as a potential omitted scope item.`,
        contractor_facing: `Add to supplement: ${pickDesc(c)} (${qty(c.quantity)} ${c.unit ?? ''}) at ${money(
          total,
        )}. This appears in our scope in ${section(c)} but was not allowed by the carrier.`,
        adjuster_facing: `Please review the omission of ${pickDesc(c)} in ${section(
          c,
        )}. Contractor scope shows ${qty(c.quantity)} ${c.unit ?? ''} with a total of ${money(
          total,
        )}; no matching allowance is present in the carrier estimate.`,
        internal_reviewer: `missing_from_carrier severity=${m.severity} canonical=${c.canonical_key} fingerprint=${c.fingerprint}`,
      };
    }
    case 'missing_from_contractor': {
      const c = m.carrier!;
      return {
        plain_english: `The carrier scope includes ${pickDesc(c)} (${qty(c.quantity)} ${
          c.unit ?? ''
        }) in ${section(c)} with total ${money(
          c.total_rcv,
        )}. No matching line was found in the contractor scope. Review whether this item is duplicative, already included elsewhere, or genuinely missing from the contractor estimate.`,
        contractor_facing: `Carrier included ${pickDesc(c)} (${qty(c.quantity)} ${
          c.unit ?? ''
        }) for ${money(c.total_rcv)} that we did not. Confirm whether this was intentionally excluded or should be added.`,
        adjuster_facing: `Noted that the carrier scope contains ${pickDesc(c)} which is not present in the contractor scope. Provided for reconciliation.`,
        internal_reviewer: `missing_from_contractor severity=${m.severity} canonical=${c.canonical_key} fingerprint=${c.fingerprint}`,
      };
    }
    case 'quantity_delta': {
      const car = m.carrier!;
      const con = m.contractor!;
      const delta = (con.quantity ?? 0) - (car.quantity ?? 0);
      const totalDelta = (con.total_rcv ?? 0) - (car.total_rcv ?? 0);
      return {
        plain_english: `The carrier allowed ${qty(car.quantity)} ${car.unit ?? ''} for ${pickDesc(
          car,
        )}, while the contractor scope includes ${qty(con.quantity)} ${con.unit ?? ''} for ${pickDesc(
          con,
        )}. The quantity difference is ${qty(delta)} ${con.unit ?? car.unit ?? ''}, creating a total RCV difference of ${money(
          totalDelta,
        )}.`,
        contractor_facing: `Supplement the quantity for ${pickDesc(con)} by ${qty(delta)} ${
          con.unit ?? ''
        } (carrier ${qty(car.quantity)}, contractor ${qty(con.quantity)}). Estimated added RCV: ${money(
          totalDelta,
        )}.`,
        adjuster_facing: `Please reconcile the quantity for ${pickDesc(
          car,
        )}. Contractor measurement supports ${qty(con.quantity)} ${
          con.unit ?? ''
        } vs the ${qty(car.quantity)} ${car.unit ?? ''} currently allowed.`,
        internal_reviewer: `quantity_delta severity=${m.severity} canonical=${con.canonical_key} carrier_fp=${car.fingerprint} contractor_fp=${con.fingerprint}`,
      };
    }
    case 'price_delta':
    case 'price_list_delta_possible': {
      const car = m.carrier!;
      const con = m.contractor!;
      const x = car.unit_price ?? 0;
      const y = con.unit_price ?? 0;
      const z = y - x;
      const priceListNote =
        m.result_type === 'price_list_delta_possible'
          ? ' This difference may be partially or fully explained by a difference in price-list date between the two estimates.'
          : '';
      return {
        plain_english: `The matched item shows a unit price difference. Carrier unit price: ${money(
          x,
        )}. Contractor unit price: ${money(y)}. Difference: ${money(
          z,
        )}. Review whether this is caused by R&R pricing, price-list date, labor/material split, or missing removal/replacement components.${priceListNote}`,
        contractor_facing: `Unit price gap on ${pickDesc(con)}: carrier ${money(x)} vs contractor ${money(
          y,
        )} (Δ ${money(z)}).${priceListNote}`,
        adjuster_facing: `Please review the unit pricing for ${pickDesc(
          car,
        )}. Current allowance: ${money(x)}; contractor pricing: ${money(y)}.${priceListNote}`,
        internal_reviewer: `${m.result_type} severity=${m.severity} canonical=${con.canonical_key}`,
      };
    }
    case 'grouped_missing_from_carrier': {
      const group = (m.grouped_children ?? []).map((c) => c.contractor).filter(Boolean) as NormalizedScopeItem[];
      const total = group.reduce((s, i) => s + (i.total_rcv ?? 0), 0);
      const groupName = group[0]?.canonical_group ?? group[0]?.canonical_key ?? 'related';
      return {
        plain_english: `The contractor scope includes multiple related ${groupName} lines totaling ${money(
          total,
        )}. The carrier scope does not include a matching grouped allowance. These lines should be reviewed together rather than individually because they appear to represent the same work category across multiple elevations/sections.`,
        contractor_facing: `Group missing on carrier (${groupName}): ${group.length} line(s) totaling ${money(
          total,
        )}. Sections: ${group.map((g) => g.section_name ?? '—').join(', ')}.`,
        adjuster_facing: `Please consider a grouped allowance for ${groupName}. Contractor scope includes ${group.length} elevation-specific line(s) totaling ${money(
          total,
        )} that have no matching grouped or per-elevation allowance in the current carrier estimate.`,
        internal_reviewer: `grouped_missing_from_carrier group_id=${m.group_id ?? '-'} children=${group.length} total=${total.toFixed(2)}`,
      };
    }
    case 'grouped_quantity_delta':
    case 'grouped_total_delta': {
      const car = m.carrier;
      const con = m.contractor;
      return {
        plain_english: `Grouped comparison detected a delta between carrier and contractor totals for this work category. Carrier total: ${money(
          car?.total_rcv,
        )}. Contractor total: ${money(con?.total_rcv)}. Review the grouped children below for elevation-level breakdown.`,
        contractor_facing: `Grouped ${m.result_type === 'grouped_quantity_delta' ? 'quantity' : 'total'} gap: carrier ${money(
          car?.total_rcv,
        )} vs contractor ${money(con?.total_rcv)}.`,
        adjuster_facing: `Grouped allowance appears under-scoped for this work category — please review the per-elevation breakdown.`,
        internal_reviewer: `${m.result_type} group_id=${m.group_id ?? '-'}`,
      };
    }
    case 'grouped_possible_duplicate':
      return {
        plain_english:
          'Multiple contractor lines appear to describe the same work and may collapse into a single grouped allowance. Verify that these are not duplicates billed across elevations.',
        contractor_facing: 'Confirm these elevation-specific lines are not duplicates of the same work.',
        adjuster_facing: 'Possible duplicate flagged for reviewer attention.',
        internal_reviewer: `grouped_possible_duplicate group_id=${m.group_id ?? '-'}`,
      };
    default:
      return {
        plain_english: 'No specific justification template matched this issue.',
        contractor_facing: '—',
        adjuster_facing: '—',
        internal_reviewer: `unhandled result_type=${m.result_type}`,
      };
  }
}
