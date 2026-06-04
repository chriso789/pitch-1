// Blueprint Importer v2 — Phase 7.8 estimate_line_items write-mapping helper.
//
// PURE function. No DB IO. No mutation. Produces a *future* payload only if
// every safety gate passes. Refuses to fill any NOT NULL pricing column with
// a default zero. Never infers markup, tax, discount, or customer-facing
// final price.
//
// Source of truth: docs/blueprint-estimate-line-write-mapping-contract.md

import type { PreflightCandidateResult } from "./phase7_6c-preflight.ts";

export const PHASE_7_8_WRITE_MAPPING_VERSION = "v2.0-write-mapping-phase-7.8" as const;

export const PHASE_7_8_WRITE_MAPPING_BLOCKER_CODES = [
  "ESTIMATE_LINE_UNIT_COST_MISSING",
  "ESTIMATE_LINE_TOTAL_PRICE_MISSING",
  "ESTIMATE_LINE_DEFAULT_ZERO_UNSAFE",
  "ESTIMATE_LINE_MARKUP_RULE_MISSING",
  "ESTIMATE_LINE_PRICE_MAPPING_UNSAFE",
  "ESTIMATE_LINE_METADATA_SURFACE_MISSING",
  "PRICING_CONTRACT_REQUIRED",
] as const;
export type Phase7_8WriteMappingBlocker =
  typeof PHASE_7_8_WRITE_MAPPING_BLOCKER_CODES[number];

export interface WriteMappingInput {
  candidate: {
    id: string;
    tenant_id: string;
    quantity: number | null;
    unit: string | null;
    item_name: string;
    item_category: string; // 'material' | 'labor' | etc.
    material_id?: string | null;
    labor_rate_id?: string | null;
    /** True if the validator below confirmed material_id/labor_rate_id is tenant-safe and active. */
    target_validated: boolean;
  };
  preflight: Pick<PreflightCandidateResult, "preview_cost" | "pricing_status" | "blockers">;
  /** Pricing decision object (markup rule) supplied by the operator's pricing contract. */
  pricing: {
    /** Required final unit_cost (positive number). */
    unit_cost: number | null;
    /** Optional markup rule. If markup is required (markup_required=true) and this is missing → block. */
    markup_rule_id: string | null;
    /** Whether this candidate's target flow REQUIRES a markup rule (proposal-bound). */
    markup_required: boolean;
    /** Optional explicit total_price; if missing AND markup_rule is missing → block. */
    total_price: number | null;
  };
  /** True only after approval object has been signed and provenance bridge will be written. */
  approval_ready: boolean;
}

export interface WriteMappingPayload {
  /** Fields ready to insert into estimate_line_items. Caller still wraps in a transaction. */
  tenant_id: string;
  item_category: string;
  item_name: string;
  quantity: number;
  unit_type: string;
  unit_cost: number;
  extended_cost: number;
  total_price: number;
  markup_percent: number | null;
  markup_amount: number | null;
  material_id: string | null;
  labor_rate_id: string | null;
  notes: string;
}

export interface WriteMappingResult {
  mapping_version: typeof PHASE_7_8_WRITE_MAPPING_VERSION;
  ok: boolean;
  payload: WriteMappingPayload | null;
  blockers: Phase7_8WriteMappingBlocker[];
  notes: string[];
}

export function buildEstimateLineWritePayload(input: WriteMappingInput): WriteMappingResult {
  const blockers: Phase7_8WriteMappingBlocker[] = [];
  const notes: string[] = [];

  if (!input.approval_ready) {
    blockers.push("PRICING_CONTRACT_REQUIRED");
    notes.push("Approval object not signed — no write payload may be produced.");
  }

  const qty = input.candidate.quantity;
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
    blockers.push("ESTIMATE_LINE_PRICE_MAPPING_UNSAFE");
    notes.push("Candidate quantity is missing or non-positive.");
  }

  // unit_cost: must come from the explicit pricing contract, positive, non-default-zero.
  const uc = input.pricing.unit_cost;
  if (typeof uc !== "number" || !Number.isFinite(uc)) {
    blockers.push("ESTIMATE_LINE_UNIT_COST_MISSING");
  } else if (uc === 0) {
    blockers.push("ESTIMATE_LINE_DEFAULT_ZERO_UNSAFE");
  } else if (uc < 0) {
    blockers.push("ESTIMATE_LINE_PRICE_MAPPING_UNSAFE");
  }

  // markup rule
  if (input.pricing.markup_required && !input.pricing.markup_rule_id && input.pricing.total_price == null) {
    blockers.push("ESTIMATE_LINE_MARKUP_RULE_MISSING");
  }

  // total_price requirement: must be explicit, never inferred here.
  const tp = input.pricing.total_price;
  if ((typeof tp !== "number" || !Number.isFinite(tp))) {
    blockers.push("ESTIMATE_LINE_TOTAL_PRICE_MISSING");
  } else if (tp === 0) {
    blockers.push("ESTIMATE_LINE_DEFAULT_ZERO_UNSAFE");
  }

  // material_id / labor_rate_id: only preserved when validated.
  if ((input.candidate.material_id || input.candidate.labor_rate_id) && !input.candidate.target_validated) {
    blockers.push("ESTIMATE_LINE_METADATA_SURFACE_MISSING");
    notes.push("material_id/labor_rate_id supplied but candidate.target_validated=false.");
  }

  if (blockers.length > 0) {
    return {
      mapping_version: PHASE_7_8_WRITE_MAPPING_VERSION,
      ok: false,
      payload: null,
      blockers: Array.from(new Set(blockers)),
      notes,
    };
  }

  const safeQty = qty as number;
  const safeUc = uc as number;
  const safeTp = tp as number;
  const extended = Number((safeQty * safeUc).toFixed(4));

  const payload: WriteMappingPayload = {
    tenant_id: input.candidate.tenant_id,
    item_category: input.candidate.item_category,
    item_name: input.candidate.item_name,
    quantity: safeQty,
    unit_type: input.candidate.unit ?? "ea",
    unit_cost: safeUc,
    extended_cost: extended,
    total_price: safeTp,
    // Never inferred — only passed through when supplied by pricing contract.
    markup_percent: null,
    markup_amount: null,
    material_id: input.candidate.target_validated ? (input.candidate.material_id ?? null) : null,
    labor_rate_id: input.candidate.target_validated ? (input.candidate.labor_rate_id ?? null) : null,
    notes: "blueprint-importer-v2",
  };

  return {
    mapping_version: PHASE_7_8_WRITE_MAPPING_VERSION,
    ok: true,
    payload,
    blockers: [],
    notes,
  };
}
