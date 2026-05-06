import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  MousePointer2, Type, Highlighter, EyeOff, PenTool, RotateCcw,
  RotateCw, Download, Save, Undo2, Redo2,
} from 'lucide-react';

export type ToolMode = 'select' | 'text' | 'annotate' | 'redact';

interface PdfToolbarProps {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCompile: () => void;
  onSave: () => void;
  isCompiling: boolean;
  isSaving: boolean;
  operationCount: number;
  onRotatePage?: () => void;
}

export function PdfToolbar({
  mode, onModeChange, canUndo, canRedo, onUndo, onRedo,
  onCompile, onSave, isCompiling, isSaving, operationCount, onRotatePage,
}: PdfToolbarProps) {
  const tools: { key: ToolMode; icon: any; label: string }[] = [
    { key: 'select', icon: MousePointer2, label: 'Select' },
    { key: 'text', icon: Type, label: 'Text' },
    { key: 'annotate', icon: Highlighter, label: 'Annotate' },
    { key: 'redact', icon: EyeOff, label: 'Redact' },
  ];

  return (
    <div className="flex items-center gap-1 p-2 border rounded-lg bg-card flex-wrap">
      {tools.map(t => (
        <Button
          key={t.key}
          variant={mode === t.key ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onModeChange(t.key)}
        >
          <t.icon className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">{t.label}</span>
        </Button>
      ))}

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} title="Undo">
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} title="Redo">
        <Redo2 className="h-4 w-4" />
      </Button>

      {onRotatePage && (
        <Button variant="ghost" size="icon" onClick={onRotatePage} title="Rotate page">
          <RotateCw className="h-4 w-4" />
        </Button>
      )}

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving}>
        <Save className="h-4 w-4 mr-1" />
        {isSaving ? 'Saving...' : 'Save'}
      </Button>
      <Button size="sm" onClick={onCompile} disabled={isCompiling}>
        <Download className="h-4 w-4 mr-1" />
        {isCompiling ? 'Compiling...' : 'Compile'}
      </Button>

      {operationCount > 0 && (
        <Badge variant="secondary" className="ml-1">{operationCount} ops</Badge>
      )}
    </div>
  );
}
