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
