import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface RunCompareInput {
  carrier_document_id: string;
  company_document_id: string;
  project_id?: string | null;
  job_id?: string | null;
}

export function useRunXactComparison() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RunCompareInput) => {
      const { data, error } = await supabase.functions.invoke('xact-compare-documents', { body: input });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scope-comparisons'] }),
  });
}

export function useProjectComparisons(projectId?: string | null) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ['scope-comparisons', tenantId, projectId],
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scope_comparisons')
        .select('*')
        .eq('tenant_id', tenantId!)
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useComparisonLines(comparisonId?: string | null) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ['scope-comparison-lines', tenantId, comparisonId],
    enabled: !!tenantId && !!comparisonId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scope_comparison_lines')
        .select('*')
        .eq('tenant_id', tenantId!)
        .eq('comparison_id', comparisonId!)
        .order('change_type');
      if (error) throw error;
      return data || [];
    },
  });
}

export function useProjectScopeDocuments(projectId?: string | null, jobId?: string | null) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ['insurance-scope-documents', tenantId, projectId, jobId],
    enabled: !!tenantId && (!!projectId || !!jobId),
    queryFn: async () => {
      let q = supabase
        .from('insurance_scope_documents')
        .select('id, document_type, file_name, carrier_normalized, parse_status, created_at, job_id')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false });
      if (jobId) q = q.eq('job_id', jobId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

export function useDeleteComparison() {
  const qc = useQueryClient();
  const tenantId = useEffectiveTenantId();
  return useMutation({
    mutationFn: async (comparisonId: string) => {
      const { error } = await supabase
        .from('scope_comparisons')
        .delete()
        .eq('tenant_id', tenantId!)
        .eq('id', comparisonId);
      if (error) throw error;
      return comparisonId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scope-comparisons'] });
      qc.invalidateQueries({ queryKey: ['scope-comparison-lines'] });
      qc.invalidateQueries({ queryKey: ['supplement-reports'] });
    },
  });
}

export function useGenerateSupplementReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (comparison_id: string) => {
      const { data, error } = await supabase.functions.invoke('generate-supplement-report', {
        body: { comparison_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scope-comparisons'] });
      qc.invalidateQueries({ queryKey: ['supplement-reports'] });
    },
  });
}

export function useSupplementReports(comparisonId?: string | null) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ['supplement-reports', tenantId, comparisonId],
    enabled: !!tenantId && !!comparisonId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplement_reports')
        .select('*')
        .eq('tenant_id', tenantId!)
        .eq('comparison_id', comparisonId!)
        .order('version', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}
