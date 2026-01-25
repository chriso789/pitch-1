// =====================================================
// Segment Hover Context
// Shared hover state between summary panel and diagram
// =====================================================

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Types
type SegmentType = 'eave' | 'rake' | 'ridge' | 'hip' | 'valley' | 'step' | null;

interface SegmentHoverContextValue {
  hoveredSegmentType: SegmentType;
  hoveredSegmentIndex: number | null;
  setHoveredSegment: (type: SegmentType, index?: number | null) => void;
  clearHover: () => void;
  isSegmentHighlighted: (type: string, index?: number) => boolean;
}

const SegmentHoverContext = createContext<SegmentHoverContextValue | null>(null);

// Provider component
export function SegmentHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredSegmentType, setHoveredType] = useState<SegmentType>(null);
  const [hoveredSegmentIndex, setHoveredIndex] = useState<number | null>(null);

  const setHoveredSegment = useCallback((type: SegmentType, index: number | null = null) => {
    setHoveredType(type);
    setHoveredIndex(index);
  }, []);

  const clearHover = useCallback(() => {
    setHoveredType(null);
    setHoveredIndex(null);
  }, []);

  // Check if a segment should be highlighted
  const isSegmentHighlighted = useCallback((type: string, index?: number): boolean => {
    if (!hoveredSegmentType) return false;
    
    // Match by type (e.g., all eaves highlighted when hovering "Eaves: 87'")
    if (hoveredSegmentType.toLowerCase() === type.toLowerCase()) {
      // If no specific index, highlight all of this type
      if (hoveredSegmentIndex === null) return true;
      // Otherwise only highlight matching index
      return hoveredSegmentIndex === index;
    }
    
    return false;
  }, [hoveredSegmentType, hoveredSegmentIndex]);

  const value: SegmentHoverContextValue = {
    hoveredSegmentType,
    hoveredSegmentIndex,
    setHoveredSegment,
    clearHover,
    isSegmentHighlighted,
  };

  return (
    <SegmentHoverContext.Provider value={value}>
      {children}
    </SegmentHoverContext.Provider>
  );
}

// Hook to use segment hover
export function useSegmentHover() {
  const context = useContext(SegmentHoverContext);
  if (!context) {
    // Return a no-op implementation if not wrapped in provider
    return {
      hoveredSegmentType: null as SegmentType,
      hoveredSegmentIndex: null,
      setHoveredSegment: () => {},
      clearHover: () => {},
      isSegmentHighlighted: () => false,
    };
  }
  return context;
}

// Optional hook that doesn't throw if context is missing
export function useSegmentHoverOptional() {
  return useContext(SegmentHoverContext);
}

export default SegmentHoverContext;
