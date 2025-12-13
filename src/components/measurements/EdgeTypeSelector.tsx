import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, Triangle, Mountain, Slash, Minus } from 'lucide-react';

export type EdgeType = 'eave' | 'rake' | 'hip' | 'valley' | 'ridge' | 'step_flashing';

interface EdgeTypeSelectorProps {
  selectedType: EdgeType;
  onTypeChange: (type: EdgeType) => void;
  edgeCounts?: Record<EdgeType, number>;
  compact?: boolean;
  disabled?: boolean;
}

interface EdgeTypeConfig {
  type: EdgeType;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
}

const EDGE_TYPES: EdgeTypeConfig[] = [
  {
    type: 'eave',
    label: 'Eave',
    shortLabel: 'E',
    description: 'Bottom horizontal edge (gutter line)',
    color: '#10b981', // Green
    bgColor: 'bg-emerald-500',
    icon: <Minus className="h-3 w-3" />,
  },
  {
    type: 'rake',
    label: 'Rake',
    shortLabel: 'R',
    description: 'Sloped edge at gable end',
    color: '#3b82f6', // Blue
    bgColor: 'bg-blue-500',
    icon: <Slash className="h-3 w-3" />,
  },
  {
    type: 'hip',
    label: 'Hip',
    shortLabel: 'H',
    description: 'External angle where two planes meet',
    color: '#f59e0b', // Amber
    bgColor: 'bg-amber-500',
    icon: <Mountain className="h-3 w-3" />,
  },
  {
    type: 'valley',
    label: 'Valley',
    shortLabel: 'V',
    description: 'Internal angle where two planes meet',
    color: '#8b5cf6', // Purple
    bgColor: 'bg-purple-500',
    icon: <ArrowDown className="h-3 w-3" />,
  },
  {
    type: 'ridge',
    label: 'Ridge',
    shortLabel: 'Ri',
    description: 'Top peak where planes meet',
    color: '#ef4444', // Red
    bgColor: 'bg-red-500',
    icon: <ArrowUp className="h-3 w-3" />,
  },
  {
    type: 'step_flashing',
    label: 'Step',
    shortLabel: 'S',
    description: 'Step flashing at wall intersection',
    color: '#6b7280', // Gray
    bgColor: 'bg-gray-500',
    icon: <Triangle className="h-3 w-3" />,
  },
];

export function EdgeTypeSelector({
  selectedType,
  onTypeChange,
  edgeCounts,
  compact = false,
  disabled = false,
}: EdgeTypeSelectorProps) {
  return (
    <TooltipProvider>
      <div className={cn(
        "flex flex-wrap gap-1",
        compact ? "gap-0.5" : "gap-1.5"
      )}>
        {EDGE_TYPES.map((edge) => {
          const isSelected = selectedType === edge.type;
          const count = edgeCounts?.[edge.type] || 0;
          
          return (
            <Tooltip key={edge.type}>
              <TooltipTrigger asChild>
                <Button
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  disabled={disabled}
                  onClick={() => onTypeChange(edge.type)}
                  className={cn(
                    "relative transition-all",
                    compact ? "h-7 px-2 text-xs" : "h-8 px-3",
                    isSelected && "ring-2 ring-offset-1",
                  )}
                  style={{
                    borderColor: isSelected ? edge.color : undefined,
                    backgroundColor: isSelected ? edge.color : undefined,
                  }}
                >
                  <span className={cn(
                    "flex items-center gap-1",
                    isSelected && "text-white"
                  )}>
                    {edge.icon}
                    {compact ? edge.shortLabel : edge.label}
                  </span>
                  
                  {count > 0 && (
                    <Badge 
                      variant="secondary" 
                      className={cn(
                        "ml-1 h-4 px-1 text-[10px]",
                        isSelected && "bg-white/20 text-white"
                      )}
                    >
                      {count}
                    </Badge>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[200px]">
                <p className="font-medium">{edge.label}</p>
                <p className="text-xs text-muted-foreground">{edge.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

/**
 * Color legend for edge types
 */
export function EdgeTypeLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-2",
      compact ? "gap-1.5 text-xs" : "gap-3 text-sm"
    )}>
      {EDGE_TYPES.map((edge) => (
        <div key={edge.type} className="flex items-center gap-1">
          <div 
            className={cn("rounded-sm", compact ? "w-2 h-2" : "w-3 h-3")}
            style={{ backgroundColor: edge.color }}
          />
          <span className="text-muted-foreground">{edge.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Get the color for an edge type
 */
export function getEdgeTypeColor(type: EdgeType): string {
  const config = EDGE_TYPES.find(e => e.type === type);
  return config?.color || '#6b7280';
}

/**
 * Get all edge type configs
 */
export function getEdgeTypes(): EdgeTypeConfig[] {
  return EDGE_TYPES;
}
