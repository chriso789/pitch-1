import { useState, useCallback } from 'react';
import type { SplitFacet } from '@/utils/polygonSplitting';

interface FacetManagerState {
  facets: SplitFacet[];
  selectedFacetId: string | null;
  undoStack: SplitFacet[][];
  redoStack: SplitFacet[][];
}

export function useFacetManager(initialFacets: SplitFacet[] = []) {
  const [state, setState] = useState<FacetManagerState>({
    facets: initialFacets,
    selectedFacetId: null,
    undoStack: [],
    redoStack: [],
  });

  const pushToUndoStack = useCallback((currentFacets: SplitFacet[]) => {
    setState(prev => ({
      ...prev,
      undoStack: [...prev.undoStack, currentFacets],
      redoStack: [], // Clear redo stack on new action
    }));
  }, []);

  const setFacets = useCallback((newFacets: SplitFacet[]) => {
    setState(prev => {
      pushToUndoStack(prev.facets);
      return { ...prev, facets: newFacets };
    });
  }, [pushToUndoStack]);

  const selectFacet = useCallback((facetId: string | null) => {
    setState(prev => ({ ...prev, selectedFacetId: facetId }));
  }, []);

  const updateFacet = useCallback((facetId: string, updates: Partial<SplitFacet>) => {
    setState(prev => {
      pushToUndoStack(prev.facets);
      return {
        ...prev,
        facets: prev.facets.map(f => 
          f.id === facetId ? { ...f, ...updates } : f
        ),
      };
    });
  }, [pushToUndoStack]);

  const deleteFacet = useCallback((facetId: string) => {
    setState(prev => {
      pushToUndoStack(prev.facets);
      return {
        ...prev,
        facets: prev.facets.filter(f => f.id !== facetId),
        selectedFacetId: prev.selectedFacetId === facetId ? null : prev.selectedFacetId,
      };
    });
  }, [pushToUndoStack]);

  const addFacet = useCallback((facet: SplitFacet) => {
    setState(prev => {
      pushToUndoStack(prev.facets);
      return {
        ...prev,
        facets: [...prev.facets, facet],
      };
    });
  }, [pushToUndoStack]);

  const undo = useCallback(() => {
    setState(prev => {
      if (prev.undoStack.length === 0) return prev;
      const previousState = prev.undoStack[prev.undoStack.length - 1];
      return {
        ...prev,
        facets: previousState,
        undoStack: prev.undoStack.slice(0, -1),
        redoStack: [...prev.redoStack, prev.facets],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState(prev => {
      if (prev.redoStack.length === 0) return prev;
      const nextState = prev.redoStack[prev.redoStack.length - 1];
      return {
        ...prev,
        facets: nextState,
        undoStack: [...prev.undoStack, prev.facets],
        redoStack: prev.redoStack.slice(0, -1),
      };
    });
  }, []);

  return {
    facets: state.facets,
    selectedFacetId: state.selectedFacetId,
    selectFacet,
    setFacets,
    updateFacet,
    deleteFacet,
    addFacet,
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
