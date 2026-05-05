import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { getPdfSignedUrl } from '@/lib/pdf-workspace/getPdfSignedUrl';

export function usePdfWorkspaceDocument(documentId: string | undefined) {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();

  const documentQuery = useQuery({
    queryKey: ['pdf-workspace-document', documentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pdf_workspace_documents')
        .select('*')
        .eq('id', documentId)
        .eq('tenant_id', tenantId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!documentId && !!tenantId,
  });

  const pdfUrlQuery = useQuery({
    queryKey: ['pdf-workspace-url', documentId, documentQuery.data?.current_path],
    queryFn: async () => {
      const doc = documentQuery.data;
      if (!doc) return null;
      const bucket = doc.current_bucket || doc.original_bucket;
      const path = doc.current_path || doc.original_path;
      return getPdfSignedUrl(bucket, path);
    },
    enabled: !!documentQuery.data,
  });

  const updateTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      const { error } = await (supabase as any)
        .from('pdf_workspace_documents')
        .update({ title, updated_by: user?.id })
        .eq('id', documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      const qc = useQueryClient();
      qc.invalidateQueries({ queryKey: ['pdf-workspace-document', documentId] });
    },
  });

  return {
    document: documentQuery.data,
    isLoading: documentQuery.isLoading,
    pdfUrl: pdfUrlQuery.data,
    isPdfLoading: pdfUrlQuery.isLoading,
    updateTitle: updateTitleMutation.mutateAsync,
    refetch: documentQuery.refetch,
  };
}
