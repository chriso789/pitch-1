import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { uploadPdfToWorkspace } from '@/lib/pdf-workspace/uploadPdfToWorkspace';

export function usePdfWorkspace(statusFilter?: string, sourceFilter?: string) {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const documentsQuery = useQuery({
    queryKey: ['pdf-workspace-documents', tenantId, statusFilter, sourceFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from('pdf_workspace_documents')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (sourceFilter && sourceFilter !== 'all') {
        query = query.eq('source_type', sourceFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!tenantId || !user?.id) throw new Error('Not authenticated');
      return uploadPdfToWorkspace({
        file,
        tenantId,
        userId: user.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-workspace-documents'] });
    },
  });

  return {
    documents: documentsQuery.data || [],
    isLoading: documentsQuery.isLoading,
    error: documentsQuery.error,
    uploadPdf: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    refetch: documentsQuery.refetch,
  };
}
