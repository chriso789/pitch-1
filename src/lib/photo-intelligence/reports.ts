/**
 * Versioned persistence for Photo Intelligence reports (Phase 6).
 * Every save creates a NEW version row — reports are never edited in place,
 * so the exact content a customer saw is always retrievable.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PhotoIntelligenceReport } from './reportModel';

export interface SavedReport {
  id: string;
  tenant_id: string;
  project_id: string | null;
  version: number;
  report: PhotoIntelligenceReport;
  status: 'draft' | 'approved' | 'exported';
  created_by: string | null;
  created_at: string;
}

export async function listReportVersions(tenantId: string, projectId?: string | null): Promise<SavedReport[]> {
  let q = (supabase.from as any)('photo_intelligence_reports')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SavedReport[];
}

/** Save a new version. Version number is always max(existing)+1 — no overwrites. */
export async function saveReportVersion(
  tenantId: string,
  projectId: string | null,
  report: PhotoIntelligenceReport,
  status: SavedReport['status'],
  userId: string,
): Promise<SavedReport> {
  const existing = await listReportVersions(tenantId, projectId);
  const version = (existing[0]?.version ?? 0) + 1;
  const { data, error } = await (supabase.from as any)('photo_intelligence_reports')
    .insert({ tenant_id: tenantId, project_id: projectId, version, report: { ...report, version }, status, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data as SavedReport;
}
