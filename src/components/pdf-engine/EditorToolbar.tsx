/**
 * PITCH PDF Editor Toolbar
 * Mode switching, undo/redo, compile controls.
 */

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  MousePointer2, Type, Highlighter, EyeOff,
  Undo2, Redo2, Download, Save, Loader2
} from 'lucide-react';

export type EditorMode = 'select' | 'text' | 'annotate' | 'redact';

interface EditorToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCompile: () => void;
  onSave: () => void;
  isCompiling: boolean;
  isSaving: boolean;
  operationCount: number;
}

export function EditorToolbar({
  mode,
  onModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCompile,
  onSave,
  isCompiling,
  isSaving,
  operationCount,
}: EditorToolbarProps) {
  const tools: { id: EditorMode; icon: any; label: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select & Edit' },
    { id: 'text', icon: Type, label: 'Add Text' },
    { id: 'annotate', icon: Highlighter, label: 'Annotate' },
    { id: 'redact', icon: EyeOff, label: 'Redact' },
  ];

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 p-2 border-b bg-background/95 backdrop-blur">
        {/* Tool modes */}
        {tools.map(tool => (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                variant={mode === tool.id ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => onModeChange(tool.id)}
              >
                <tool.icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tool.label}</TooltipContent>
          </Tooltip>
        ))}

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Undo/Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!canUndo} onClick={onUndo}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!canRedo} onClick={onRedo}>
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Status */}
        <span className="text-xs text-muted-foreground px-2">
          {operationCount} edit{operationCount !== 1 ? 's' : ''}
        </span>

        <div className="flex-1" />

        {/* Actions */}
        <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>

        <Button size="sm" onClick={onCompile} disabled={isCompiling}>
          {isCompiling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
          Compile PDF
        </Button>
      </div>
    </TooltipProvider>
  );
}
