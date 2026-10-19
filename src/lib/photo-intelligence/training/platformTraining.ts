/**
 * Platform-wide training: company contribution consent + counts-only overview.
 * Original photos stay private to each company; the overview never returns
 * photos, links, embeddings, addresses or company names.
 */
import { supabase } from '@/integrations/supabase/client';

export const TRAINING_TERMS_VERSION = 'pitch-photo-training-v1';
export type ContributionStatus = 'not_enrolled' | 'opted_in' | 'withdrawn';

export interface PlatformClassRow { cls: string; condition: string | null; examples: number; properties: number; companies: number }
export interface PlatformOverview {
  companies_total: number; companies_opted_in: number; eligible_photos: number;
  approved_examples: number; properties: number; by_class: PlatformClassRow[]; pooling_active: boolean;
}

/** Only opted-in companies count; withdrawn or never-enrolled companies are excluded from future datasets. */
export function contributesToTraining(status: ContributionStatus | null | undefined): boolean {
  return status === 'opted_in';
}

/** Shared-model readiness per class: 30 examples from at least 3 properties and 2 companies. */
export function sharedClassReady(r: PlatformClassRow, minExamples = 30, minProperties = 3, minCompanies = 2): boolean {
  return r.examples >= minExamples && r.properties >= minProperties && r.companies >= minCompanies;
}

export async function loadContribution(tenantId: string) {
  const { data } = await (supabase.from as any)('photo_training_contributions').select('status, terms_version, authorized_at, withdrawn_at').eq('tenant_id', tenantId).maybeSingle();
  const { data: events } = await (supabase.from as any)('photo_training_contribution_events').select('action, terms_version, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20);
  return { status: (data?.status ?? 'not_enrolled') as ContributionStatus, row: data, events: events ?? [] };
}

export async function setContribution(tenantId: string, optIn: boolean) {
  const { error } = await (supabase.rpc as any)('set_photo_training_contribution', { _tenant_id: tenantId, _opt_in: optIn, _terms_version: optIn ? TRAINING_TERMS_VERSION : null });
  if (error) throw error;
}

export async function loadPlatformOverview(): Promise<PlatformOverview> {
  const { data, error } = await (supabase.rpc as any)('platform_training_overview');
  if (error) throw error;
  return data as PlatformOverview;
}
