// Blueprint Importer v2 — Phase 3 frontend API.
// All calls route through the existing document-worker grouped function via
// edgeApi. No standalone edge functions are created.

import { edgeApi } from "@/lib/edgeApi";

export interface IngestPayload {
  bucket?: string;
  path?: string;
  storage_path?: string;
  document_id?: string;
  source_context_type?: "project" | "opportunity" | "lead" | "estimate" | "contact" | "standalone";
  source_context_id?: string | null;
  original_filename?: string | null;
}

export interface IngestResult {
  session_id: string;
  source_document_id: string;
  classifier: {
    document_type: string;
    provider: string;
    confidence: number;
    signals: string[];
    db_document_type: string;
    db_provider: string;
  };
  parser: string;
  overall_confidence: number;
  measurement_count: number;
  detected_trade_count: number;
  plan_path_count: number;
  deterministic_hash: string;
  supersedes_session_id: string | null;
}

export interface SessionSummary {
  session: Record<string, unknown>;
  source_documents: Array<Record<string, unknown>>;
  detected_trades: Array<{
    id: string;
    trade_id: string;
    support_status: "mvp_supported" | "measurement_object_only" | "future_supported" | "unsupported";
    confidence: number;
    source_document_ids: string[];
    status: string;
  }>;
  accepted_trades: Array<{ id: string; trade_id: string; review_state: string; accepted_at: string }>;
  measurements: Array<{
    id: string;
    trade_id: string | null;
    measurement_key: string;
    quantity: number | null;
    unit: string | null;
    confidence: number;
    plan_path_id: string | null;
    normalized_value: Record<string, unknown> | null;
  }>;
  plan_paths: Array<Record<string, unknown>>;
  review_flags: Array<{
    id: string;
    severity: "info" | "warning" | "error" | "blocker";
    flag_code: string;
    message: string;
    blocking: boolean;
    resolved: boolean;
    related_entity_type: string;
  }>;
}

export async function ingestBlueprintReport(payload: IngestPayload) {
  const { data, error } = await edgeApi<IngestResult>("document-worker", "/blueprint-importer/v2/ingest", payload as unknown as Record<string, unknown>);
  if (error) throw new Error(error);
  return data!;
}

export async function fetchBlueprintImportSession(session_id: string) {
  const { data, error } = await edgeApi<SessionSummary>("document-worker", "/blueprint-importer/v2/session", { session_id });
  if (error) throw new Error(error);
  return data!;
}

export async function acceptBlueprintTrade(params: {
  session_id: string;
  trade_id: string;
  detected_trade_id?: string | null;
  requested_review_state?: "pending_review" | "manual_only";
  user_assumptions?: Record<string, unknown>;
}) {
  const { data, error } = await edgeApi<{ accepted_trade: Record<string, unknown> }>(
    "document-worker",
    "/blueprint-importer/v2/accept-trade",
    params,
  );
  if (error) throw new Error(error);
  return data!;
}

// -------------------- Phase 4 helpers --------------------

export interface BindTemplateResult {
  template_binding: {
    trade_id: string;
    internal_template_key: string | null;
    template_name: string | null;
    required_inputs: Record<string, { label: string; required: boolean; resolved_value: unknown; source: string }>;
    optional_inputs: Record<string, { label: string; required: boolean; resolved_value: unknown; source: string }>;
    missing_inputs: string[];
    binding_status: "pending" | "ready" | "blocked";
    user_assumptions: Record<string, unknown>;
  } | null;
  binding_id: string | null;
  review_flags: Array<{ flag_code: string; message: string; blocking: boolean; severity: string }>;
}

export interface GenerateDraftsResult {
  mode: "materials" | "labor";
  template_binding_id: string | null;
  template_binding: BindTemplateResult["template_binding"];
  material_drafts: Array<Record<string, unknown>>;
  labor_drafts: Array<Record<string, unknown>>;
  review_flags: Array<{ flag_code: string; message: string; blocking: boolean; severity: string }>;
  blocked_summary: string[];
  inserted_count: number;
}

export interface DraftLinesResult {
  bindings: Array<Record<string, unknown>>;
  material_draft_lines: Array<Record<string, unknown>>;
  labor_draft_lines: Array<Record<string, unknown>>;
  trade_templates: Array<{ accepted_trade_id: string; trade_id: string; template: unknown }>;
}

export async function bindBlueprintTemplate(params: {
  session_id: string;
  accepted_trade_id: string;
  user_assumptions?: Record<string, unknown>;
}) {
  const { data, error } = await edgeApi<BindTemplateResult>(
    "document-worker",
    "/blueprint-importer/v2/bind-template",
    params,
  );
  if (error) throw new Error(error);
  return data!;
}

export async function generateBlueprintMaterialDrafts(params: {
  session_id: string;
  accepted_trade_id: string;
  user_assumptions?: Record<string, unknown>;
}) {
  const { data, error } = await edgeApi<GenerateDraftsResult>(
    "document-worker",
    "/blueprint-importer/v2/generate-material-drafts",
    params,
  );
  if (error) throw new Error(error);
  return data!;
}

export async function generateBlueprintLaborDrafts(params: {
  session_id: string;
  accepted_trade_id: string;
  user_assumptions?: Record<string, unknown>;
}) {
  const { data, error } = await edgeApi<GenerateDraftsResult>(
    "document-worker",
    "/blueprint-importer/v2/generate-labor-drafts",
    params,
  );
  if (error) throw new Error(error);
  return data!;
}

export async function fetchBlueprintDraftLines(session_id: string) {
  const { data, error } = await edgeApi<DraftLinesResult>(
    "document-worker",
    "/blueprint-importer/v2/draft-lines",
    { session_id },
  );
  if (error) throw new Error(error);
  return data!;
}

// -------------------- Phase 6 helpers --------------------

export type Phase6DraftMode = "material" | "labor" | "both";

export interface HandoffPreviewSummary {
  handoff_batch_id: string;
  deterministic_batch_key: string;
  batch_status: string;
  total_candidates: number;
  candidates_handoff_allowed: number;
  skipped: Array<{ draft_id: string; draft_type: "material" | "labor"; trade_id: string; reasons: string[] }>;
  blocker_summary: Record<string, number>;
  warning_summary: Record<string, number>;
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
}

export interface HandoffPreviewBatchRow {
  id: string;
  tenant_id: string;
  import_session_id: string;
  status: string;
  pricing_mode: string;
  catalog_mode: string;
  custom_line_mode: string;
  canonical_estimate_target_table: string;
  canonical_estimate_target_id: string | null;
  target_context_type: string;
  target_context_id: string | null;
  deterministic_batch_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HandoffPreviewCandidateRow {
  id: string;
  handoff_batch_id: string;
  accepted_trade_id: string;
  template_binding_id: string | null;
  source_draft_line_id: string;
  source_draft_line_type: "material" | "labor";
  trade_id: string;
  item_key: string;
  item_name: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  source_document_ids: string[];
  formula_key: string | null;
  catalog_resolution_status: string;
  catalog_item_id: string | null;
  pricing_status: string;
  cost_status: string;
  user_review_status: string;
  handoff_allowed: boolean;
  handoff_blockers: string[];
  blocking_review_flag_ids: string[];
  warning_review_flag_ids: string[];
  provenance_summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: string;
}

export interface HandoffPreviewGetResult {
  batch: HandoffPreviewBatchRow | null;
  candidates: HandoffPreviewCandidateRow[];
  target_estimate: { id: string; status: string | null; estimate_number: string | null; display_name: string | null } | null;
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
  disabled_actions?: Record<string, string>;
}

export async function createBlueprintHandoffPreview(params: {
  import_session_id: string;
  target_context_type?: string;
  target_context_id?: string | null;
  canonical_estimate_target_id?: string | null;
  accepted_trade_ids?: string[] | null;
  draft_mode?: Phase6DraftMode;
  pricing_mode?: "quantity_only" | "ready_for_pricing_review";
  catalog_mode?: "catalog_resolved_only" | "preview_only";
}) {
  const { data, error } = await edgeApi<HandoffPreviewSummary>(
    "document-worker",
    "/blueprint-importer/v2/handoff-preview",
    params as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}

export async function fetchBlueprintHandoffPreview(params: { handoff_batch_id?: string; import_session_id?: string }) {
  const { data, error } = await edgeApi<HandoffPreviewGetResult>(
    "document-worker",
    "/blueprint-importer/v2/handoff-preview/get",
    params as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}

export async function reviewBlueprintHandoffCandidate(params: {
  handoff_batch_id: string;
  candidate_id: string;
  user_review_status: "pending" | "reviewed" | "excluded";
}) {
  const { data, error } = await edgeApi<{ ok: true; candidate_id: string; user_review_status: string }>(
    "document-worker",
    "/blueprint-importer/v2/handoff-preview/review",
    params as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}


// -------------------- Phase 7.6b helpers --------------------
// Deterministic binding resolver runtime. NO pricing, NO live writes.

export type BlueprintResolverV2RuntimeStatus =
  | "resolved" | "unresolved" | "ambiguous"
  | "inactive_binding" | "inactive_target" | "unit_mismatch"
  | "tenant_scope_mismatch" | "missing_labor_rate" | "blocked";

export interface BlueprintResolverV2RuntimeResult {
  resolver_version: string;
  tenant_id: string;
  source_candidate_id: string;
  trade_id: string;
  source_item_key: string;
  source_candidate_type: "material" | "labor";
  source_unit: string;
  status: BlueprintResolverV2RuntimeStatus;
  matched_binding_id: string | null;
  matched_target_kind: string | null;
  matched_target_table: string | null;
  matched_target_item_id: string | null;
  matched_target_abc_item_number: string | null;
  matched_labor_rate_id: string | null;
  matched_target_unit: string | null;
  uses_unit_conversion: boolean;
  requires_user_confirmation: boolean;
  match_confidence: number;
  blockers: string[];
  warnings: string[];
  provenance: {
    attempted_binding_ids: string[];
    rejected: Array<{ binding_id: string; reason: string }>;
    resolved_at: string | null;
  };
  binding_summary: string | null;
}

export interface ResolveBindingsSummary {
  handoff_batch_id: string;
  resolver_mode: "blueprint_catalog_bindings_only";
  resolver_version: string;
  contract_version: string;
  dry_run: boolean;
  total_candidates: number;
  summary: {
    total: number;
    by_status: Record<BlueprintResolverV2RuntimeStatus, number>;
    resolved: number;
    blocked: number;
    ambiguous: number;
    missing: number;
    blocker_counts: Record<string, number>;
    warning_counts: Record<string, number>;
    handoff_still_blocked: true;
    push_to_estimate_enabled: false;
    push_to_estimate_disabled_reason: string;
  };
  results: BlueprintResolverV2RuntimeResult[];
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
  pricing_preflight_enabled: false;
  pricing_preflight_disabled_reason: string;
}

export async function resolveBlueprintCatalogBindings(params: {
  handoff_batch_id: string;
  candidate_ids?: string[] | null;
  dry_run?: boolean;
}) {
  const { data, error } = await edgeApi<ResolveBindingsSummary>(
    "document-worker",
    "/blueprint-importer/v2/resolve-bindings",
    {
      ...params,
      resolver_mode: "blueprint_catalog_bindings_only",
      contract_version: "blueprint-importer-v2",
    } as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}

export interface ResolveBindingsGetResult {
  handoff_batch_id: string;
  batch: Record<string, unknown> | null;
  resolver_version: string;
  candidates: Array<Record<string, unknown> & {
    metadata?: { resolver_v2_result?: BlueprintResolverV2RuntimeResult; binding_summary?: string | null };
  }>;
  summary: ResolveBindingsSummary["summary"] | null;
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
}

export async function fetchBlueprintResolverResults(params: {
  handoff_batch_id: string;
  candidate_ids?: string[];
}) {
  const { data, error } = await edgeApi<ResolveBindingsGetResult>(
    "document-worker",
    "/blueprint-importer/v2/resolve-bindings/get",
    params as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}


// -------------------- Phase 7.6c helpers --------------------
// Pricing preflight (preview-only). NO live writes. NO final pricing.

export type PreflightPricingStatus =
  | "blocked_quantity_only_unsafe"
  | "cost_unresolved"
  | "catalog_resolved_cost_missing"
  | "catalog_resolved_cost_available"
  | "labor_rate_missing"
  | "pricing_rule_missing"
  | "ready_for_pricing_review"
  | "blocked";

export type PreflightCostStatus =
  | "not_attempted" | "missing" | "zero_unsafe"
  | "explicit_positive" | "explicit_zero_approved"
  | "unit_mismatch" | "production_rate_required"
  | "tenant_mismatch" | "target_inactive" | "target_missing"
  | "target_active_unverifiable" | "out_of_scope";

export interface PreflightCandidateResult {
  candidate_id: string;
  preflight_version: string;
  pricing_mode: string;
  pricing_contract_version: string;
  cost_status: PreflightCostStatus;
  pricing_status: PreflightPricingStatus;
  target_validation: {
    target_kind: string | null;
    target_present: boolean;
    tenant_safe: boolean;
    active: boolean | null;
    active_verifiable: boolean;
    unit_compatible: boolean;
    notes: string[];
  };
  preview_cost: {
    unit_cost: number | null;
    quantity: number | null;
    extended_cost: number | null;
    cost_source: string | null;
    preview_only: true;
  };
  blockers: string[];
  warnings: string[];
  handoff_allowed: false;
  evaluated_at: string;
}

export interface PreflightBatchSummary {
  total: number;
  ready_for_pricing_review: number;
  blocked: number;
  blocker_counts: Record<string, number>;
  warning_counts: Record<string, number>;
  pricing_status_counts: Record<string, number>;
  cost_status_counts: Record<string, number>;
  preview_cost_total: number | null;
  preview_only: true;
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
  final_pricing_enabled: false;
  final_pricing_disabled_reason: string;
}

export interface PricingPreflightRunResult {
  handoff_batch_id: string;
  preflight_version: string;
  contract_version: string;
  pricing_mode: string;
  dry_run: boolean;
  total_candidates: number;
  summary: PreflightBatchSummary;
  results: PreflightCandidateResult[];
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
  final_pricing_enabled: false;
  final_pricing_disabled_reason: string;
}

export async function runBlueprintPricingPreflight(params: {
  handoff_batch_id: string;
  candidate_ids?: string[] | null;
  pricing_mode?: "quantity_only" | "ready_for_pricing_review";
  dry_run?: boolean;
}) {
  const { data, error } = await edgeApi<PricingPreflightRunResult>(
    "document-worker",
    "/blueprint-importer/v2/pricing-preflight",
    { ...params, contract_version: "blueprint-importer-v2" } as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}

export async function fetchBlueprintPricingPreflight(params: {
  handoff_batch_id: string;
  candidate_ids?: string[];
}) {
  const { data, error } = await edgeApi<{
    handoff_batch_id: string; batch: Record<string, unknown> | null;
    preflight_version: string;
    candidates: Array<Record<string, unknown> & { metadata?: { pricing_preflight?: PreflightCandidateResult } }>;
    summary: PreflightBatchSummary | null;
    push_to_estimate_enabled: false;
    push_to_estimate_disabled_reason: string;
    final_pricing_enabled: false;
  }>(
    "document-worker",
    "/blueprint-importer/v2/pricing-preflight/get",
    params as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!;
}
