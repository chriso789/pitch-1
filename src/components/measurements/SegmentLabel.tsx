// =====================================================
// Phase 72: Segment Label Component
// Display individual measurements on diagram lines
// =====================================================

import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SegmentLabelProps {
  segmentId: string;
  edgeType: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'step' | 'drip' | 'flashing';
  lengthFt: number;
  position: { x: number; y: number };
  rotation?: number;
  isSelected?: boolean;
  isHighlighted?: boolean;
  showLabel?: boolean;
  onClick?: (segmentId: string) => void;
  onDoubleClick?: (segmentId: string) => void;
  className?: string;
}

// Edge type colors and labels
const EDGE_CONFIG: Record<string, { color: string; bgColor: string; label: string }> = {
  ridge: { color: 'text-red-600', bgColor: 'bg-red-100 border-red-300', label: 'Ridge' },
  hip: { color: 'text-orange-600', bgColor: 'bg-orange-100 border-orange-300', label: 'Hip' },
  valley: { color: 'text-blue-600', bgColor: 'bg-blue-100 border-blue-300', label: 'Valley' },
  eave: { color: 'text-green-600', bgColor: 'bg-green-100 border-green-300', label: 'Eave' },
  rake: { color: 'text-purple-600', bgColor: 'bg-purple-100 border-purple-300', label: 'Rake' },
  step: { color: 'text-yellow-600', bgColor: 'bg-yellow-100 border-yellow-300', label: 'Step' },
  drip: { color: 'text-cyan-600', bgColor: 'bg-cyan-100 border-cyan-300', label: 'Drip' },
  flashing: { color: 'text-pink-600', bgColor: 'bg-pink-100 border-pink-300', label: 'Flashing' },
};

export function SegmentLabel({
  segmentId,
  edgeType,
  lengthFt,
  position,
  rotation = 0,
  isSelected = false,
  isHighlighted = false,
  showLabel = true,
  onClick,
  onDoubleClick,
  className,
}: SegmentLabelProps) {
  const config = EDGE_CONFIG[edgeType] || EDGE_CONFIG.eave;
  
  // Format length display
  const formatLength = (ft: number): string => {
    if (ft >= 100) return `${Math.round(ft)}'`;
    if (ft >= 10) return `${ft.toFixed(1)}'`;
    return `${ft.toFixed(2)}'`;
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(segmentId);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.(segmentId);
  };

  if (!showLabel) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'absolute cursor-pointer transition-all duration-150 z-10',
              'flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-medium',
              'shadow-sm hover:shadow-md hover:scale-105',
              config.bgColor,
              isSelected && 'ring-2 ring-primary ring-offset-1',
              isHighlighted && 'animate-pulse',
              className
            )}
            style={{
              left: position.x,
              top: position.y,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            role="button"
            tabIndex={0}
            aria-label={`${config.label}: ${formatLength(lengthFt)}`}
          >
            <span className={cn('font-semibold', config.color)}>
              {formatLength(lengthFt)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-semibold">{config.label}</div>
            <div className="text-sm">
              Length: {lengthFt.toFixed(2)} ft ({(lengthFt * 12).toFixed(1)} in)
            </div>
            <div className="text-xs text-muted-foreground">
              ID: {segmentId}
            </div>
            <div className="text-xs text-muted-foreground">
              Click to select • Double-click to edit
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Segment labels overlay for diagram
interface SegmentLabelsOverlayProps {
  segments: Array<{
    id: string;
    segment_id: string;
    edge_type: string;
    length_ft: number;
    label_position?: { x: number; y: number };
    start_point: { x: number; y: number };
    end_point: { x: number; y: number };
  }>;
  containerWidth: number;
  containerHeight: number;
  selectedSegmentId?: string | null;
  onSegmentClick?: (segmentId: string) => void;
  onSegmentDoubleClick?: (segmentId: string) => void;
  showLabels?: boolean;
}

export function SegmentLabelsOverlay({
  segments,
  containerWidth,
  containerHeight,
  selectedSegmentId,
  onSegmentClick,
  onSegmentDoubleClick,
  showLabels = true,
}: SegmentLabelsOverlayProps) {
  if (!showLabels || segments.length === 0) return null;

  // Calculate label position at midpoint of segment
  const calculateLabelPosition = (segment: typeof segments[0]) => {
    if (segment.label_position) {
      return {
        x: segment.label_position.x * containerWidth,
        y: segment.label_position.y * containerHeight,
      };
    }
    
    // Default to midpoint
    return {
      x: ((segment.start_point.x + segment.end_point.x) / 2) * containerWidth,
      y: ((segment.start_point.y + segment.end_point.y) / 2) * containerHeight,
    };
  };

  // Calculate rotation angle
  const calculateRotation = (segment: typeof segments[0]) => {
    const dx = segment.end_point.x - segment.start_point.x;
    const dy = segment.end_point.y - segment.start_point.y;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // Keep labels readable (not upside down)
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    
    return angle;
  };

  return (
    <div className="absolute inset-0 pointer-events-none">
      {segments.map((segment) => {
        const position = calculateLabelPosition(segment);
        const rotation = calculateRotation(segment);
        
        return (
          <div key={segment.id} className="pointer-events-auto">
            <SegmentLabel
              segmentId={segment.segment_id}
              edgeType={segment.edge_type as any}
              lengthFt={segment.length_ft}
              position={position}
              rotation={0} // Keep labels horizontal for readability
              isSelected={selectedSegmentId === segment.segment_id}
              onClick={onSegmentClick}
              onDoubleClick={onSegmentDoubleClick}
            />
          </div>
        );
      })}
    </div>
  );
}

// Edge type legend
export function SegmentLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {Object.entries(EDGE_CONFIG).map(([type, config]) => (
        <Badge
          key={type}
          variant="outline"
          className={cn('text-xs', config.bgColor, config.color)}
        >
          {config.label}
        </Badge>
      ))}
    </div>
  );
}

export default SegmentLabel;
