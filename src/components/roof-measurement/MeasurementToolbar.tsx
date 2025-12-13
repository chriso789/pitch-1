import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Square, Minus, CornerRightDown, Undo2, Trash2,
  MousePointer2, ArrowDown, ArrowRight, Layers, Circle, Frame
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type DrawingTool = 
  | 'select' 
  | 'roof' 
  | 'ridge' 
  | 'hip' 
  | 'valley' 
  | 'eave' 
  | 'rake' 
  | 'step_flashing' 
  | 'penetration'
  | 'drip_edge';

interface ToolConfig {
  id: DrawingTool;
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  description: string;
  category: 'general' | 'area' | 'linear' | 'point';
}

const TOOLS: ToolConfig[] = [
  {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    color: 'text-foreground',
    bgColor: 'bg-muted',
    description: 'Select and move objects',
    category: 'general',
  },
  {
    id: 'roof',
    label: 'Facet',
    icon: Square,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    description: 'Draw roof facet area (double-click to close)',
    category: 'area',
  },
  {
    id: 'ridge',
    label: 'Ridge',
    icon: Minus,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    description: 'Mark ridge lines (horizontal peak)',
    category: 'linear',
  },
  {
    id: 'hip',
    label: 'Hip',
    icon: CornerRightDown,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    description: 'Mark hip lines (sloped edge)',
    category: 'linear',
  },
  {
    id: 'valley',
    label: 'Valley',
    icon: CornerRightDown,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    description: 'Mark valley lines (internal corner)',
    category: 'linear',
  },
  {
    id: 'eave',
    label: 'Eave',
    icon: ArrowDown,
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
    description: 'Mark eave lines (horizontal bottom edge)',
    category: 'linear',
  },
  {
    id: 'rake',
    label: 'Rake',
    icon: ArrowRight,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    description: 'Mark rake lines (sloped gable edge)',
    category: 'linear',
  },
  {
    id: 'step_flashing',
    label: 'Step Flash',
    icon: Layers,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    description: 'Mark step flashing (where roof meets wall)',
    category: 'linear',
  },
  {
    id: 'drip_edge',
    label: 'Drip Edge',
    icon: Frame,
    color: 'text-teal-500',
    bgColor: 'bg-teal-500/10',
    description: 'Mark drip edge perimeter',
    category: 'linear',
  },
  {
    id: 'penetration',
    label: 'Penetration',
    icon: Circle,
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    description: 'Mark vents, skylights, chimneys',
    category: 'point',
  },
];

interface MeasurementToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  onClear: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

export function MeasurementToolbar({
  activeTool,
  onToolChange,
  onClear,
  onUndo,
  canUndo,
}: MeasurementToolbarProps) {
  const generalTools = TOOLS.filter(t => t.category === 'general');
  const areaTools = TOOLS.filter(t => t.category === 'area');
  const linearTools = TOOLS.filter(t => t.category === 'linear');
  const pointTools = TOOLS.filter(t => t.category === 'point');

  const renderToolButton = (tool: ToolConfig) => (
    <Button
      key={tool.id}
      variant={activeTool === tool.id ? 'default' : 'ghost'}
      size="sm"
      onClick={() => onToolChange(tool.id)}
      className={cn(
        'flex-col h-auto py-2 px-2 gap-1 min-w-[52px]',
        activeTool === tool.id && 'ring-2 ring-primary ring-offset-1',
        activeTool !== tool.id && tool.bgColor
      )}
      title={tool.description}
    >
      <tool.icon className={cn('h-4 w-4', activeTool === tool.id ? 'text-primary-foreground' : tool.color)} />
      <span className="text-[10px] leading-tight">{tool.label}</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-2 p-2 bg-muted/50 rounded-lg">
      {/* Tool Categories */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* General Tools */}
        {generalTools.map(renderToolButton)}

        <Separator orientation="vertical" className="h-10 mx-1" />

        {/* Area Tools */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground px-1">Area:</span>
          {areaTools.map(renderToolButton)}
        </div>

        <Separator orientation="vertical" className="h-10 mx-1" />

        {/* Linear Tools */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground px-1">Lines:</span>
          {linearTools.map(renderToolButton)}
        </div>

        <Separator orientation="vertical" className="h-10 mx-1" />

        {/* Point Tools */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground px-1">Points:</span>
          {pointTools.map(renderToolButton)}
        </div>

        <Separator orientation="vertical" className="h-10 mx-1" />

        {/* Actions */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex-col h-auto py-2 px-2 gap-1"
          title="Undo last action"
        >
          <Undo2 className="h-4 w-4" />
          <span className="text-[10px]">Undo</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="flex-col h-auto py-2 px-2 gap-1 text-destructive hover:text-destructive"
          title="Clear all drawings"
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-[10px]">Clear</span>
        </Button>
      </div>

      {/* Active Tool Indicator */}
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <span>Active:</span>
        <span className={cn('font-medium', TOOLS.find(t => t.id === activeTool)?.color)}>
          {TOOLS.find(t => t.id === activeTool)?.label}
        </span>
        <span className="text-muted-foreground/60">—</span>
        <span className="text-muted-foreground/80">
          {TOOLS.find(t => t.id === activeTool)?.description}
        </span>
      </div>
    </div>
  );
}
