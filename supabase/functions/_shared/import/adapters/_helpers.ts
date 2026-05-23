// Adapter helpers — shared utilities used by all vendor adapters.

import type {
  AdapterDetection, ImportFileDescriptor, ImportMigrationPlan,
  ImportSourceManifest, PitchImportEntity, VendorImportAdapter,
} from "./types.ts";
import { bandFromScore } from "./types.ts";

export function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function fileMatchesAny(name: string, needles: string[]): boolean {
  const n = name.toLowerCase();
  return needles.some((x) => n.includes(x));
}

export function headersInclude(headers: string[] | undefined, names: string[]): number {
  if (!headers?.length) return 0;
  const hs = headers.map((h) => h.toLowerCase().trim());
  return names.reduce((acc, n) => acc + (hs.includes(n.toLowerCase()) ? 1 : 0), 0);
}

export function buildFolderStructure(files: ImportFileDescriptor[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of files) {
    const folder = f.folder ?? (f.path ? f.path.split("/").slice(0, -1).join("/") || "/" : "/");
    (out[folder] ??= []).push(f.name);
  }
  return out;
}

export function emptyDetection(): AdapterDetection {
  return { confidence: 0, detectedEntities: {}, warnings: [] };
}

/** Build a generic migration plan from a manifest, with sensible ordering and confidence scoring. */
export function planFromManifest(
  manifest: ImportSourceManifest,
  required: Record<string, string[]>,
  optional: Record<string, string[]> = {},
  extraRisks: string[] = [],
): ImportMigrationPlan {
  const order: PitchImportEntity[] = [
    "contact", "property", "lead", "job", "project",
    "estimate", "invoice", "payment",
    "budget", "budget_line_item",
    "note", "activity", "document", "image",
  ];
  const present = order.filter((e) => (manifest.detected_entities[e] ?? 0) > 0);

  const totalRequired = Object.values(required).reduce((a, b) => a + b.length, 0) || 1;
  // Phase 1 has no actual mapping audit; treat declared requireds as 80% covered baseline.
  const coverageScore = 0.8;
  const validityScore = 0.9;     // staging not yet validated
  const dedupeScore = 1.0;       // no live duplicates checked
  const linkScore = manifest.warnings.length === 0 ? 1.0 : 0.85;
  const mappingScore = 0.85;

  const detection = Math.max(0, Math.min(1, manifest.detected_confidence));
  const raw = detection * coverageScore * validityScore * dedupeScore * linkScore * mappingScore;
  const score = Math.round(raw * 100);

  return {
    source_system: manifest.source_system,
    entity_order: present.length > 0 ? present : order,
    estimated_counts: manifest.detected_entities,
    required_mappings: required,
    optional_mappings: optional,
    unresolved_requirements: Object.entries(required)
      .filter(([e]) => (manifest.detected_entities[e] ?? 0) > 0)
      .flatMap(([e, fields]) => fields.map((f) => `${e}.${f}`))
      .slice(0, 20),
    risk_flags: [...manifest.warnings.slice(0, 10), ...extraRisks],
    recommended_actions: [
      "Review normalized preview before commit.",
      "Map old reps/statuses/categories to Pitch equivalents.",
      "Confirm document/photo folder categorization.",
    ],
    confidence_score: score,
    confidence_band: bandFromScore(score),
  };
}

/** Field-map suggester that overlays a vendor-specific dictionary on top of free input headers. */
export function suggestFromDictionary(
  dict: Record<PitchImportEntity, Record<string, string>>,
  entity: PitchImportEntity,
  fields: string[],
): Record<string, string> {
  const table = dict[entity] ?? {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    const lower = f.toLowerCase().trim();
    const hit = table[lower] ?? table[f];
    if (hit) out[f] = hit;
  }
  return out;
}

/** Build a minimal manifest from files + a detection result. */
export function buildManifestFromFiles(
  sourceSystem: string,
  files: ImportFileDescriptor[],
  detection: AdapterDetection,
): ImportSourceManifest {
  return {
    source_system: sourceSystem,
    detected_confidence: detection.confidence,
    files,
    detected_entities: detection.detectedEntities,
    folder_structure: buildFolderStructure(files),
    warnings: detection.warnings,
  };
}

/** Minimal stub adapter behaviour for entity types we don't yet field-map in Phase 1. */
export async function stubNormalize(adapter: VendorImportAdapter, input: { entityType: PitchImportEntity; raw: Record<string, unknown> }) {
  return {
    entityType: input.entityType,
    normalized: { _raw: input.raw, _stub: true, _adapter: adapter.sourceSystem },
    warnings: [`Phase 1 stub: ${adapter.sourceSystem} adapter has no field map for ${input.entityType} yet.`],
    confidence: 0.1,
  };
}
