import { supabase } from '@/integrations/supabase/client';

export type DetectionSource = 'ai' | 'reference_label' | 'manual';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_closeup';
export type Severity = 'immediate' | 'high' | 'moderate' | 'low' | 'cosmetic' | 'unknown';

export interface PhotoFinding {
  id: string;
  tenant_id: string;
  project_id: string | null;
  job_id: string | null;
  finding_ref: string;
  building_label: string | null;
  roof_plane: string | null;
  component: string;
  material: string | null;
  visible_condition: string;
  condition_description: string | null;
  detection_source: DetectionSource;
  ai_confidence: number | null;
  severity: Severity;
  urgency: string;
  water_exposure_concern: boolean;
  recommended_verification: string | null;
  limitations: string | null;
  measured_quantity: number | null;
  measured_unit: string | null;
  measurement_source: string | null;
  review_status: ReviewStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface FindingEvidence {
  id: string;
  finding_id: string;
  photo_id: string | null;
  storage_path: string | null;
  evidence_role: 'primary' | 'supporting' | 'close_up';
  annotation: Record<string, unknown> | null;
  annotation_source: DetectionSource;
}

const TABLE = 'photo_findings' as const;

export async function listFindings(tenantId: string, opts: { projectId?: string; status?: ReviewStatus } = {}): Promise<PhotoFinding[]> {
  let q = (supabase.from as any)(TABLE).select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
  if (opts.projectId) q = q.eq('project_id', opts.projectId);
  if (opts.status) q = q.eq('review_status', opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PhotoFinding[];
}

export async function createFinding(tenantId: string, input: Partial<PhotoFinding> & { finding_ref: string }, userId: string): Promise<PhotoFinding> {
  const { data, error } = await (supabase.from as any)(TABLE)
    .insert({ tenant_id: tenantId, created_by: userId, ...input, review_status: 'pending' })
    .select().single();
  if (error) throw error;
  return data as PhotoFinding;
}

export async function listEvidence(findingId: string): Promise<FindingEvidence[]> {
  const { data, error } = await (supabase.from as any)('photo_finding_evidence').select('*').eq('finding_id', findingId);
  if (error) throw error;
  return (data ?? []) as FindingEvidence[];
}

/**
 * Record a human review action and apply the resulting status.
 * Approval is enforced by the photo_finding_approval_guard trigger: the review
 * row must exist (with reviewed_by = auth user) before the finding flips to approved.
 */
export async function reviewFinding(
  finding: PhotoFinding,
  action: 'approve' | 'reject' | 'needs_closeup',
  userId: string,
  notes?: string,
): Promise<void> {
  const newStatus: ReviewStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'needs_closeup';
  const { error: revErr } = await (supabase.from as any)('photo_finding_reviews').insert({
    tenant_id: finding.tenant_id,
    finding_id: finding.id,
    action,
    previous_status: finding.review_status,
    new_status: newStatus,
    notes: notes ?? null,
    reviewed_by: userId,
  });
  if (revErr) throw revErr;
  const { error } = await (supabase.from as any)(TABLE)
    .update({ review_status: newStatus, approved_by: action === 'approve' ? userId : null, updated_at: new Date().toISOString() })
    .eq('id', finding.id);
  if (error) throw error;
}

/** Group findings by building label for the building-by-building inventory. */
export function groupByBuilding(findings: PhotoFinding[]): Map<string, PhotoFinding[]> {
  const map = new Map<string, PhotoFinding[]>();
  for (const f of findings) {
    const key = f.building_label?.trim() || 'Unassigned building';
    const arr = map.get(key) ?? [];
    arr.push(f);
    map.set(key, arr);
  }
  return map;
}
