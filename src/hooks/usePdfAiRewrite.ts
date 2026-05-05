import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';

interface AiRewriteRequest {
  workspaceDocumentId: string;
  selectedText: string;
  instruction: string;
  pageNumber?: number;
}

export function usePdfAiRewrite() {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ workspaceDocumentId, selectedText, instruction, pageNumber }: AiRewriteRequest) => {
      if (!tenantId || !user?.id) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('pdf-ai-rewrite', {
        body: {
          workspace_document_id: workspaceDocumentId,
          selected_text: selectedText,
          instruction,
          page_number: pageNumber,
        },
      });

      if (error) throw error;
      return data;
    },
  });
}
