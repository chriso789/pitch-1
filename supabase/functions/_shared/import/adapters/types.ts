// Vendor Migration Adapter Layer — shared types.
// Phase 1: staging-only. No live commits.

export type PitchImportEntity =
  | "lead"
  | "contact"
  | "property"
  | "job"
  | "project"
  | "estimate"
  | "invoice"
  | "payment"
  | "budget"
  | "budget_line_item"
  | "document"
  | "image"
  | "activity"
  | "note"
  | "message"
  | "call"
  | "task";

export interface ImportFileDescriptor {
  id?: string;                // import_files.id when persisted
  name: string;               // original file name (with extension)
  path?: string;              // virtual path inside ZIP / storage key
  size?: number;
  mime_type?: string;
  ext?: string;               // lowercased file extension
  headers?: string[];         // CSV/XLSX column headers if available
  sample_rows?: Record<string, unknown>[]; // first few rows
  folder?: string;            // immediate parent folder
}

export interface AdapterDetection {
  confidence: number;                    // 0..1
  detectedEntities: Record<string, number>; // entityType -> approx record count
  warnings: string[];
}

export interface ImportSourceManifest {
  source_system: string;
  detected_confidence: number;
  files: ImportFileDescriptor[];
  detected_entities: Record<string, number>;
  folder_structure: Record<string, string[]>;
  warnings: string[];
}

export interface ImportMigrationPlan {
  source_system: string;
  entity_order: PitchImportEntity[];
  estimated_counts: Record<string, number>;
  required_mappings: Record<string, string[]>; // entity -> required pitch fields
  optional_mappings: Record<string, string[]>;
  unresolved_requirements: string[];
  risk_flags: string[];
  recommended_actions: string[];
  confidence_score: number;       // 0..100
  confidence_band: "safe" | "review" | "cleanup" | "do_not_import" | "unknown";
}

export interface NormalizeInput {
  entityType: PitchImportEntity;
  raw: Record<string, unknown>;
  fieldMap?: Record<string, string>;
  batchId: string;
  tenantId: string;
}

export interface NormalizeOutput {
  entityType: PitchImportEntity;
  sourceRecordId?: string;
  normalized: Record<string, unknown>;
  warnings: string[];
  confidence: number; // 0..1
}

export interface VendorImportAdapter {
  sourceSystem: string;
  displayName: string;
  version: string;
  supportedFileTypes: string[];
  supportedEntityTypes: PitchImportEntity[];

  detect(files: ImportFileDescriptor[]): Promise<AdapterDetection>;
  buildManifest(files: ImportFileDescriptor[]): Promise<ImportSourceManifest>;
  suggestFieldMap(entityType: PitchImportEntity, fields: string[]): Promise<Record<string, string>>;
  normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput>;
  buildMigrationPlan(manifest: ImportSourceManifest): Promise<ImportMigrationPlan>;
}

export function bandFromScore(score: number): ImportMigrationPlan["confidence_band"] {
  if (score >= 90) return "safe";
  if (score >= 75) return "review";
  if (score >= 50) return "cleanup";
  if (score > 0) return "do_not_import";
  return "unknown";
}
