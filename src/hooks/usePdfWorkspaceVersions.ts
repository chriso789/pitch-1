import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export function usePdfWorkspaceVersions(workspaceDocumentId: string | undefined) {
  const tenantId = useEffectiveTenantId();

  const versionsQuery = useQuery({
    queryKey: ['pdf-workspace-versions', workspaceDocumentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pdf_workspace_versions')
        .select('*')
        .eq('workspace_document_id', workspaceDocumentId)
        .eq('tenant_id', tenantId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!workspaceDocumentId && !!tenantId,
  });

  return {
    versions: versionsQuery.data || [],
    isLoading: versionsQuery.isLoading,
    refetch: versionsQuery.refetch,
  };
}
