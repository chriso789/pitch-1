// ============================================================
// Hook: useBackfillScopes
// Trigger processing of existing insurance documents into the
// Scope Intelligence pipeline
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BackfillOptions {
  tenantId?: string;
  limit?: number;
  dryRun?: boolean;
}

interface BackfillResult {
  document_id: string;
  file_name: string;
  status: 'processed' | 'skipped' | 'failed';
  error?: string;
  scope_document_id?: string;
}

interface BackfillResponse {
  success: boolean;
  message: string;
  total_found: number;
  processed: number;
  skipped: number;
  failed: number;
  results: BackfillResult[];
  dry_run?: boolean;
  to_process?: number;
  already_processed?: number;
}

/**
 * Check how many insurance documents haven't been processed yet
 */
export function useUnprocessedDocumentCount() {
  return useQuery({
    queryKey: ['unprocessed-scope-documents'],
    queryFn: async () => {
      // Get all insurance documents
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('id, file_path')
        .eq('document_type', 'insurance');

      if (docsError) throw docsError;
      if (!documents || documents.length === 0) return 0;

      // Check which have already been processed
      const filePaths = documents.map(d => d.file_path);
      const documentIds = documents.map(d => d.id);
      
      const { data: processed, error: processedError } = await supabase
        .from('insurance_scope_documents')
        .select('storage_path, source_document_id');

      if (processedError) throw processedError;

      const processedPaths = new Set(processed?.map(p => p.storage_path) || []);
      const processedIds = new Set(processed?.map(p => p.source_document_id).filter(Boolean) || []);

      const unprocessedCount = documents.filter(
        d => !processedPaths.has(d.file_path) && !processedIds.has(d.id)
      ).length;

      return unprocessedCount;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Trigger backfill of existing insurance documents
 */
export function useBackfillScopes() {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const backfillMutation = useMutation({
    mutationFn: async (options: BackfillOptions = {}) => {
      setIsProcessing(true);
      
      const { data, error } = await supabase.functions.invoke<BackfillResponse>(
        'scope-backfill-documents',
        {
          body: {
            tenant_id: options.tenantId,
            limit: options.limit || 50,
            dry_run: options.dryRun || false,
          },
        }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Backfill failed');
      
      return data;
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      
      if (data.dry_run) {
        toast({
          title: 'Dry Run Complete',
          description: `Found ${data.to_process} documents ready to process (${data.already_processed} already processed)`,
        });
      } else {
        toast({
          title: 'Backfill Complete',
          description: data.message,
        });
      }
    },
    onError: (error) => {
      setIsProcessing(false);
      toast({
        title: 'Backfill Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  return {
    backfill: backfillMutation.mutate,
    backfillAsync: backfillMutation.mutateAsync,
    isProcessing,
    data: backfillMutation.data,
    error: backfillMutation.error,
    reset: backfillMutation.reset,
  };
}
