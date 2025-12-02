import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Square, Minus, CornerRightDown, Undo2, Trash2,
  MousePointer2
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type DrawingTool = 'select' | 'roof' | 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';

interface ToolConfig {
  id: DrawingTool;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

const TOOLS: ToolConfig[] = [
  {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    color: 'text-foreground',
    description: 'Select and move objects',
  },
  {
    id: 'roof',
    label: 'Roof',
    icon: Square,
    color: 'text-blue-500',
    description: 'Draw roof outline polygon',
  },
  {
    id: 'ridge',
    label: 'Ridge',
    icon: Minus,
    color: 'text-green-500',
    description: 'Mark ridge lines',
  },
  {
    id: 'hip',
    label: 'Hip',
    icon: CornerRightDown,
    color: 'text-purple-500',
    description: 'Mark hip lines',
  },
  {
    id: 'valley',
    label: 'Valley',
    icon: CornerRightDown,
    color: 'text-red-500',
    description: 'Mark valley lines',
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
  return (
    <div className="flex items-center gap-1 p-2 bg-muted/50 rounded-lg flex-wrap">
      {/* Drawing Tools */}
      {TOOLS.map((tool) => (
        <Button
          key={tool.id}
          variant={activeTool === tool.id ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onToolChange(tool.id)}
          className={cn(
            'flex-col h-auto py-2 px-3 gap-1',
            activeTool === tool.id && 'ring-2 ring-primary ring-offset-1'
          )}
          title={tool.description}
        >
          <tool.icon className={cn('h-4 w-4', tool.color)} />
          <span className="text-xs">{tool.label}</span>
        </Button>
      ))}

      <Separator orientation="vertical" className="h-10 mx-2" />

      {/* Actions */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onUndo}
        disabled={!canUndo}
        className="flex-col h-auto py-2 px-3 gap-1"
        title="Undo last action"
      >
        <Undo2 className="h-4 w-4" />
        <span className="text-xs">Undo</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="flex-col h-auto py-2 px-3 gap-1 text-destructive hover:text-destructive"
        title="Clear all drawings"
      >
        <Trash2 className="h-4 w-4" />
        <span className="text-xs">Clear</span>
      </Button>

      {/* Active Tool Indicator */}
      <div className="ml-auto text-sm text-muted-foreground hidden sm:block">
        Active: <span className="font-medium text-foreground">{TOOLS.find(t => t.id === activeTool)?.label}</span>
      </div>
    </div>
  );
}
