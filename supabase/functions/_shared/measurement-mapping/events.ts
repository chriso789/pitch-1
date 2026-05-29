// Phase 1.6 — structured mapping event logger.
//
// Emits JSON lines to stdout. Callers wire this into shadow/backfill scripts
// and (optionally) the measurement-api edge function. Payloads are intentionally
// PII-free: no names, addresses, phones, emails, claim numbers.

export type MappingEventName =
  | "measurement_import_normalized"
  | "measurement_mapping_previewed"
  | "measurement_mapping_persisted"
  | "measurement_mapping_superseded"
  | "measurement_mapping_unresolved"
  | "measurement_mapping_global_fallback"
  | "measurement_mapping_manual_split"
  | "measurement_mapping_safety_violation";

export interface MappingEventPayload {
  tenant_id?: string | null;
  measurement_import_id?: string | null;
  estimate_template_id?: string | null;
  estimate_id?: string | null;
  mapping_run_id?: string | null;
  dry_run?: boolean;
  assignment_count?: number;
  unresolved_count?: number;
  global_fallback_count?: number;
  manual_split_count?: number;
  safety_violation_count?: number;
  // Free-form, but must remain PII-free.
  detail?: Record<string, unknown>;
}

const PII_KEYS = /(name|email|phone|address|claim|owner|customer)/i;

function scrub(p: MappingEventPayload): MappingEventPayload {
  const out: Record<string, unknown> = { ...p };
  if (p.detail) {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.detail)) {
      if (PII_KEYS.test(k)) continue;
      d[k] = v;
    }
    out.detail = d;
  }
  return out as MappingEventPayload;
}

export function logMappingEvent(name: MappingEventName, payload: MappingEventPayload = {}) {
  const evt = {
    ts: new Date().toISOString(),
    event: name,
    ...scrub(payload),
  };
  console.log(JSON.stringify(evt));
}
