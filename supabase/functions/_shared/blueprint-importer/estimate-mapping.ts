// Blueprint Importer v2 — Estimate mapping contracts (Phase 1).
// Side-effect-free type module. No DB, no IO, no estimate generation.

import type { TradeId } from "./trade-catalog.ts";
import type { BlueprintMeasurementObject } from "./measurement-objects.ts";
import type { BlueprintPlanPath } from "./plan-path.ts";

export type ImportSessionStatus =
  | "draft"
  | "parsed"
  | "trades_detected"
  | "user_review_required"
  | "accepted"
  | "rejected"
  | "superseded"
  | "failed";

export type SourceContextType =
  | "project"
  | "opportunity"
  | "lead"
  | "estimate"
  | "contact"
  | "standalone";

export type DocumentType =
  | "roof_report"
  | "wall_report"
  | "blueprint_set"
  | "spec_book"
  | "addendum"
  | "unknown";

export type SourceProvider =
  | "roofr"
  | "eagleview"
  | "internal_geometry"
  | "user_uploaded_blueprint"
  | "unknown";

export interface BlueprintImportSession {
  id?: string;
  tenant_id: string;
  source_context_type: SourceContextType;
  source_context_id?: string | null;
  status: ImportSessionStatus;
  contract_version: string;
  deterministic_hash?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string | null;
}

export interface BlueprintSourceDocument {
  id?: string;
  import_session_id: string;
  tenant_id: string;
  file_id?: string | null;
  storage_path?: string | null;
  document_reference?: string | null;
  document_type: DocumentType;
  provider: SourceProvider;
  original_filename?: string | null;
  page_count?: number | null;
  report_date?: string | null;
  property_address?: string | null;
  property_latitude?: number | null;
  property_longitude?: number | null;
  content_hash?: string | null;
  extraction_status: "pending" | "in_progress" | "succeeded" | "failed" | "skipped";
  metadata?: Record<string, unknown>;
}

export interface BlueprintDetectedTrade {
  id?: string;
  import_session_id: string;
  tenant_id: string;
  trade_id: TradeId;
  support_status: "mvp_supported" | "measurement_object_only" | "future_supported" | "unsupported";
  confidence: number; // 0..1
  detection_signals?: Record<string, unknown>;
  source_document_ids?: string[];
  status: "detected" | "dismissed" | "superseded" | "promoted";
}

export interface BlueprintAcceptedTrade {
  id?: string;
  import_session_id: string;
  tenant_id: string;
  detected_trade_id?: string | null;
  trade_id: TradeId;
  accepted_by?: string | null;
  accepted_at?: string;
  status: "accepted" | "rejected" | "superseded";
  selected_template_id?: string | null;
  user_assumptions?: Record<string, unknown>;
  review_state: "pending_review" | "blocked" | "cleared" | "manual_only";
}

export interface BlueprintTemplateBinding {
  id?: string;
  import_session_id: string;
  tenant_id: string;
  accepted_trade_id: string;
  trade_id: TradeId;
  template_id?: string | null;
  template_version?: string | null;
  binding_status: "pending" | "ready" | "blocked" | "rejected" | "superseded";
  required_inputs: Record<string, unknown>;
  optional_inputs?: Record<string, unknown>;
  missing_inputs?: string[];
  user_assumptions?: Record<string, unknown>;
}

export interface BlueprintMaterialDraftLine {
  id?: string;
  import_session_id: string;
  tenant_id: string;
  accepted_trade_id: string;
  template_binding_id?: string | null;
  material_rule_id?: string | null;
  item_key: string;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  rounding_rule?: string | null;
  waste_percent?: number | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  formula_key?: string | null;
  formula_inputs?: Record<string, unknown>;
  catalog_resolution_status: "unresolved" | "matched" | "ambiguous" | "missing" | "manual_override";
  catalog_item_id?: string | null;
  status: "draft" | "ready" | "blocked" | "rejected" | "superseded";
}

export interface BlueprintLaborDraftLine {
  id?: string;
  import_session_id: string;
  tenant_id: string;
  accepted_trade_id: string;
  template_binding_id?: string | null;
  labor_rule_id?: string | null;
  labor_key: string;
  labor_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  base_rate?: number | null;
  complexity_multiplier?: number | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  formula_key?: string | null;
  formula_inputs?: Record<string, unknown>;
  status: "draft" | "ready" | "blocked" | "rejected" | "superseded";
}

// Re-export the measurement object + plan path types so downstream consumers
// only need to import from the package barrel.
export type { BlueprintMeasurementObject, BlueprintPlanPath };
