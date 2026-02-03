import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Type,
  Image,
  Square,
  Circle,
  Minus,
  ArrowRight,
  Highlighter,
  EyeOff,
  Stamp,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Save,
  Trash2,
  ChevronDown,
  Move,
  MousePointer2,
  PenTool,
} from 'lucide-react';

export type EditorTool = 
  | 'select'
  | 'move'
  | 'text'
  | 'image'
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'highlight'
  | 'redaction'
  | 'stamp'
  | 'freehand';

interface EditorToolbarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onSave: () => void;
  onDelete: () => void;
  hasSelection: boolean;
  saving?: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
}

interface ToolButtonProps {
  tool: EditorTool;
  activeTool: EditorTool;
  onClick: (tool: EditorTool) => void;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

const ToolButton: React.FC<ToolButtonProps> = ({
  tool,
  activeTool,
  onClick,
  icon,
  label,
  shortcut,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant={activeTool === tool ? 'default' : 'ghost'}
        size="sm"
        className="h-9 w-9 p-0"
        onClick={() => onClick(tool)}
      >
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      <p>{label}</p>
      {shortcut && <p className="text-xs text-muted-foreground">{shortcut}</p>}
    </TooltipContent>
  </Tooltip>
);

/**
 * PDF Editor Toolbar Component
 * 
 * Provides tools for editing PDF overlays:
 * - Selection/Move tools
 * - Text boxes
 * - Image insertion
 * - Shapes (rectangle, circle, line, arrow)
 * - Annotations (highlight, redaction, stamp)
 * - Undo/Redo
 * - Zoom controls
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  activeTool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onSave,
  onDelete,
  hasSelection,
  saving = false,
  undoLabel,
  redoLabel,
}) => {
  return (
    <div className="flex items-center gap-1 p-2 bg-background border-b">
      {/* Selection Tools */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="select"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<MousePointer2 className="h-4 w-4" />}
          label="Select"
          shortcut="V"
        />
        <ToolButton
          tool="move"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Move className="h-4 w-4" />}
          label="Pan"
          shortcut="H"
        />
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Text & Image */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="text"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Type className="h-4 w-4" />}
          label="Add Text Box"
          shortcut="T"
        />
        <ToolButton
          tool="image"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Image className="h-4 w-4" />}
          label="Insert Image"
          shortcut="I"
        />
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Shapes */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="rectangle"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Square className="h-4 w-4" />}
          label="Rectangle"
          shortcut="R"
        />
        <ToolButton
          tool="circle"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Circle className="h-4 w-4" />}
          label="Circle"
          shortcut="O"
        />
        <ToolButton
          tool="line"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Minus className="h-4 w-4" />}
          label="Line"
          shortcut="L"
        />
        <ToolButton
          tool="arrow"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<ArrowRight className="h-4 w-4" />}
          label="Arrow"
          shortcut="A"
        />
        <ToolButton
          tool="freehand"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<PenTool className="h-4 w-4" />}
          label="Freehand"
          shortcut="P"
        />
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Annotations */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="highlight"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Highlighter className="h-4 w-4" />}
          label="Highlight"
        />
        <ToolButton
          tool="redaction"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<EyeOff className="h-4 w-4" />}
          label="Redact"
        />
        <ToolButton
          tool="stamp"
          activeTool={activeTool}
          onClick={onToolChange}
          icon={<Stamp className="h-4 w-4" />}
          label="Stamp"
        />
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={onUndo}
              disabled={!canUndo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{undoLabel || 'Undo'}</p>
            <p className="text-xs text-muted-foreground">Ctrl+Z</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={onRedo}
              disabled={!canRedo}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{redoLabel || 'Redo'}</p>
            <p className="text-xs text-muted-foreground">Ctrl+Shift+Z</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1 border rounded-md px-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onZoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-sm w-12 text-center font-medium">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onZoomIn}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onZoomReset}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Delete selected */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={!hasSelection}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Delete Selected</p>
          <p className="text-xs text-muted-foreground">Delete</p>
        </TooltipContent>
      </Tooltip>

      {/* Save */}
      <Button
        variant="default"
        size="sm"
        onClick={onSave}
        disabled={saving}
        className="ml-2"
      >
        <Save className="h-4 w-4 mr-2" />
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  );
};

export default EditorToolbar;
