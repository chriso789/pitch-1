/**
 * PITCH PDF Engine — React Hook
 * Connects the new pdf_documents-based engine to UI.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { PdfEngine } from '@/lib/pdf-engine/PdfEngine';
import { PdfOperationEngine } from '@/lib/pdf-engine/PdfOperationEngine';
import { compileFromOperations } from '@/lib/pdf-engine/PdfCompiler';
import { PdfVersionEngine } from '@/lib/pdf-engine/PdfVersionEngine';
import type { PdfEnginePage, PdfEngineObject, PdfEngineOperation, PdfEngineOperationType } from '@/lib/pdf-engine/engineTypes';

export function usePdfEngineV2(pdfDocumentId: string | undefined) {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const opEngineRef = useRef<PdfOperationEngine | null>(null);
  const versionEngineRef = useRef<PdfVersionEngine | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);

  useEffect(() => {
    if (pdfDocumentId && user?.id && tenantId) {
      opEngineRef.current = new PdfOperationEngine(pdfDocumentId, user.id);
      versionEngineRef.current = new PdfVersionEngine(pdfDocumentId, tenantId);
      opEngineRef.current.load().then(() => {
        setCanUndo(opEngineRef.current?.canUndo ?? false);
        setCanRedo(opEngineRef.current?.canRedo ?? false);
      });
    }
  }, [pdfDocumentId, user?.id, tenantId]);

  const pagesQuery = useQuery({
    queryKey: ['pdf-engine-pages', pdfDocumentId],
    queryFn: async () => {
      const engine = new PdfEngine(pdfDocumentId!, tenantId!, user!.id);
      return engine.getPages();
    },
    enabled: !!pdfDocumentId && !!tenantId && !!user?.id,
  });

  const objectsQuery = useQuery({
    queryKey: ['pdf-engine-objects', pdfDocumentId],
    queryFn: async () => {
      const engine = new PdfEngine(pdfDocumentId!, tenantId!, user!.id);
      return engine.getObjects();
    },
    enabled: !!pdfDocumentId && !!tenantId && !!user?.id,
  });

  const operationsQuery = useQuery({
    queryKey: ['pdf-engine-operations', pdfDocumentId],
    queryFn: async () => {
      if (!opEngineRef.current) return [];
      return opEngineRef.current.load();
    },
    enabled: !!pdfDocumentId && !!user?.id,
  });

  const versionsQuery = useQuery({
    queryKey: ['pdf-engine-versions', pdfDocumentId],
    queryFn: async () => {
      if (!versionEngineRef.current) return [];
      return versionEngineRef.current.listVersions();
    },
    enabled: !!pdfDocumentId && !!tenantId,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pdf-engine-objects', pdfDocumentId] });
    queryClient.invalidateQueries({ queryKey: ['pdf-engine-operations', pdfDocumentId] });
    queryClient.invalidateQueries({ queryKey: ['pdf-engine-versions', pdfDocumentId] });
  }, [queryClient, pdfDocumentId]);

  const pushOperation = useCallback(async (
    type: PdfEngineOperationType,
    payload: Record<string, unknown>,
    targetObjectId?: string,
    pageId?: string
  ) => {
    if (!opEngineRef.current) throw new Error('Not initialized');
    const op = await opEngineRef.current.addOperation(type, payload, targetObjectId, pageId);
    setCanUndo(opEngineRef.current.canUndo);
    setCanRedo(opEngineRef.current.canRedo);
    invalidate();
    return op;
  }, [invalidate]);

  const undo = useCallback(async () => {
    if (!opEngineRef.current) return;
    await opEngineRef.current.undoOperation();
    setCanUndo(opEngineRef.current.canUndo);
    setCanRedo(opEngineRef.current.canRedo);
    invalidate();
  }, [invalidate]);

  const redo = useCallback(async () => {
    if (!opEngineRef.current) return;
    await opEngineRef.current.redoOperation();
    setCanUndo(opEngineRef.current.canUndo);
    setCanRedo(opEngineRef.current.canRedo);
    invalidate();
  }, [invalidate]);

  const compile = useCallback(async (originalBytes: ArrayBuffer): Promise<Blob> => {
    setIsCompiling(true);
    try {
      const ops = opEngineRef.current?.getActiveOps() || [];
      const objects = objectsQuery.data || [];
      const pdfBytes = await compileFromOperations(originalBytes, ops, objects);
      return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    } finally {
      setIsCompiling(false);
    }
  }, [objectsQuery.data]);

  const compileAndVersion = useCallback(async (originalBytes: ArrayBuffer) => {
    setIsCompiling(true);
    try {
      const blob = await compile(originalBytes);
      const activeOps = opEngineRef.current?.getActiveOps() || [];
      const version = await versionEngineRef.current?.createVersion(
        blob, activeOps.length, user!.id
      );
      invalidate();
      return version;
    } finally {
      setIsCompiling(false);
    }
  }, [compile, user, invalidate]);

  return {
    pages: pagesQuery.data || [],
    objects: objectsQuery.data || [],
    operations: operationsQuery.data || [],
    versions: versionsQuery.data || [],
    isLoading: pagesQuery.isLoading || objectsQuery.isLoading,
    pushOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    compile,
    compileAndVersion,
    isCompiling,
    invalidate,
  };
}
