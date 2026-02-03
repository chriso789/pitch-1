import { useState, useCallback, useRef } from 'react';

// Maximum number of history states to keep
const MAX_HISTORY_SIZE = 50;

export interface HistoryState {
  id: string;
  timestamp: number;
  label: string;
  data: unknown;
}

interface UseEditorHistoryReturn {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  historyIndex: number;
  historyLength: number;
  pushState: (data: unknown, label: string) => void;
  undo: () => HistoryState | null;
  redo: () => HistoryState | null;
  clear: () => void;
  getCurrentState: () => HistoryState | null;
}

/**
 * Hook for managing undo/redo history in the document editor
 * 
 * @example
 * const { pushState, undo, redo, canUndo, canRedo } = useEditorHistory();
 * 
 * // Save current state before making changes
 * pushState(fabricCanvas.toJSON(), 'Add text box');
 * 
 * // Undo last action
 * if (canUndo) {
 *   const prevState = undo();
 *   fabricCanvas.loadFromJSON(prevState.data);
 * }
 */
export function useEditorHistory(): UseEditorHistoryReturn {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const idCounter = useRef(0);

  const generateId = useCallback(() => {
    idCounter.current += 1;
    return `history-${Date.now()}-${idCounter.current}`;
  }, []);

  const pushState = useCallback((data: unknown, label: string) => {
    const newState: HistoryState = {
      id: generateId(),
      timestamp: Date.now(),
      label,
      data,
    };

    setHistory(prev => {
      // Truncate any redo states when adding new state
      const truncated = prev.slice(0, historyIndex + 1);
      const newHistory = [...truncated, newState];
      
      // Limit history size
      if (newHistory.length > MAX_HISTORY_SIZE) {
        return newHistory.slice(-MAX_HISTORY_SIZE);
      }
      return newHistory;
    });

    setHistoryIndex(prev => {
      const newIndex = prev + 1;
      // Adjust for truncation
      return Math.min(newIndex, MAX_HISTORY_SIZE - 1);
    });
  }, [historyIndex, generateId]);

  const undo = useCallback((): HistoryState | null => {
    if (historyIndex <= 0) return null;
    
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    return history[newIndex];
  }, [history, historyIndex]);

  const redo = useCallback((): HistoryState | null => {
    if (historyIndex >= history.length - 1) return null;
    
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    return history[newIndex];
  }, [history, historyIndex]);

  const clear = useCallback(() => {
    setHistory([]);
    setHistoryIndex(-1);
  }, []);

  const getCurrentState = useCallback((): HistoryState | null => {
    if (historyIndex < 0 || historyIndex >= history.length) return null;
    return history[historyIndex];
  }, [history, historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const undoLabel = canUndo ? history[historyIndex - 1]?.label || 'Undo' : null;
  const redoLabel = canRedo ? history[historyIndex + 1]?.label || 'Redo' : null;

  return {
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    historyIndex,
    historyLength: history.length,
    pushState,
    undo,
    redo,
    clear,
    getCurrentState,
  };
}
