/**
 * PITCH PDF Engine React Hook
 * Connects the object graph, operation manager, and compiler to the UI.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { OperationManager } from '@/lib/pdf-engine/operationManager';
import { compilePdf } from '@/lib/pdf-engine/compiler';
import { extractPdfObjects } from '@/lib/pdf-engine/objectExtractor';
import { persistExtractedPages } from '@/lib/pdf-engine/persistObjects';
import type { PdfObject, PdfOperation, PdfOperationType, PdfPageMeta } from '@/lib/pdf-engine/types';

export function usePdfEngine(workspaceDocumentId: string | undefined) {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const opManager = useRef<OperationManager | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Initialize operation manager
  useEffect(() => {
    if (workspaceDocumentId && tenantId && user?.id) {
      opManager.current = new OperationManager(workspaceDocumentId, tenantId, user.id);
      opManager.current.load().then(() => {
        setCanUndo(opManager.current?.canUndo ?? false);
        setCanRedo(opManager.current?.canRedo ?? false);
      });
    }
  }, [workspaceDocumentId, tenantId, user?.id]);

  // Load pages
  const pagesQuery = useQuery({
    queryKey: ['pdf-pages', workspaceDocumentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pdf_pages')
        .select('*')
        .eq('workspace_document_id', workspaceDocumentId)
        .eq('tenant_id', tenantId)
        .order('page_number');
      if (error) throw error;
      return (data || []) as PdfPageMeta[];
    },
    enabled: !!workspaceDocumentId && !!tenantId,
  });

  // Load objects
  const objectsQuery = useQuery({
    queryKey: ['pdf-objects', workspaceDocumentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pdf_objects')
        .select('*')
        .eq('workspace_document_id', workspaceDocumentId)
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false)
        .order('z_index');
      if (error) throw error;
      return (data || []) as PdfObject[];
    },
    enabled: !!workspaceDocumentId && !!tenantId,
  });

  // Load operations
  const operationsQuery = useQuery({
    queryKey: ['pdf-operations', workspaceDocumentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pdf_operations')
        .select('*')
        .eq('workspace_document_id', workspaceDocumentId)
        .eq('tenant_id', tenantId)
        .order('sequence_number');
      if (error) throw error;
      return (data || []) as PdfOperation[];
    },
    enabled: !!workspaceDocumentId && !!tenantId,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pdf-objects', workspaceDocumentId] });
    queryClient.invalidateQueries({ queryKey: ['pdf-operations', workspaceDocumentId] });
  }, [queryClient, workspaceDocumentId]);

  // Push operation
  const pushOperation = useCallback(async (
    type: PdfOperationType,
    data: Record<string, unknown>,
    targetObjectId?: string,
    targetPageId?: string
  ) => {
    if (!opManager.current) throw new Error('Operation manager not initialized');
    const op = await opManager.current.push(type, data, targetObjectId, targetPageId);
    setCanUndo(opManager.current.canUndo);
    setCanRedo(opManager.current.canRedo);
    invalidate();
    return op;
  }, [invalidate]);

  // Undo
  const undo = useCallback(async () => {
    if (!opManager.current) return null;
    const op = await opManager.current.undo();
    setCanUndo(opManager.current.canUndo);
    setCanRedo(opManager.current.canRedo);
    invalidate();
    return op;
  }, [invalidate]);

  // Redo
  const redo = useCallback(async () => {
    if (!opManager.current) return null;
    const op = await opManager.current.redo();
    setCanUndo(opManager.current.canUndo);
    setCanRedo(opManager.current.canRedo);
    invalidate();
    return op;
  }, [invalidate]);

  // Compile PDF
  const compile = useCallback(async (originalPdfBytes: ArrayBuffer): Promise<Blob> => {
    setIsCompiling(true);
    try {
      const activeOps = opManager.current?.getActiveOps() || [];
      const objects = objectsQuery.data || [];
      const pdfBytes = await compilePdf(originalPdfBytes, activeOps, objects);
      return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    } finally {
      setIsCompiling(false);
    }
  }, [objectsQuery.data]);

  // Extract & persist objects from uploaded PDF
  const extractAndPersist = useCallback(async (arrayBuffer: ArrayBuffer) => {
    if (!workspaceDocumentId || !tenantId) throw new Error('Missing context');
    const pages = await extractPdfObjects(arrayBuffer);
    await persistExtractedPages(workspaceDocumentId, tenantId, pages);
    queryClient.invalidateQueries({ queryKey: ['pdf-pages', workspaceDocumentId] });
    queryClient.invalidateQueries({ queryKey: ['pdf-objects', workspaceDocumentId] });
    return pages;
  }, [workspaceDocumentId, tenantId, queryClient]);

  return {
    pages: pagesQuery.data || [],
    objects: objectsQuery.data || [],
    operations: operationsQuery.data || [],
    isLoading: pagesQuery.isLoading || objectsQuery.isLoading,
    pushOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    compile,
    isCompiling,
    extractAndPersist,
  };
}
