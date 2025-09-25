import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  TestTube, 
  Move,
  Crop,
  X,
  Download,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

interface FloatingTestButtonProps {
  onRunTest: () => void;
  issueCount: number;
}

interface SnippetArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  timestamp: number;
}

export const FloatingTestButton: React.FC<FloatingTestButtonProps> = ({
  onRunTest,
  issueCount
}) => {
  const [position, setPosition] = useState({ x: window.innerWidth - 120, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showSnippetTool, setShowSnippetTool] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });
  const [snippets, setSnippets] = useState<SnippetArea[]>([]);
  const [showSnippets, setShowSnippets] = useState(false);

  const buttonRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Load snippets from localStorage
  useEffect(() => {
    const savedSnippets = localStorage.getItem('test-snippets');
    if (savedSnippets) {
      setSnippets(JSON.parse(savedSnippets));
    }
  }, []);

  // Save snippets to localStorage
  const saveSnippets = (newSnippets: SnippetArea[]) => {
    setSnippets(newSnippets);
    localStorage.setItem('test-snippets', JSON.stringify(newSnippets));
  };

  // Handle mouse events for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === buttonRef.current || buttonRef.current?.contains(e.target as Node)) {
      setIsDragging(true);
      const rect = buttonRef.current!.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y))
      });
    }

    if (isSelecting) {
      setSelectionEnd({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    if (isSelecting) {
      createSnippet();
    }
    setIsDragging(false);
    setIsSelecting(false);
  };

  // Global mouse event listeners
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isSelecting, dragOffset]);

  // Start snippet selection
  const startSnippetSelection = () => {
    setShowSnippetTool(false);
    setIsSelecting(true);
    document.body.style.cursor = 'crosshair';
    
    const handleSelectionStart = (e: MouseEvent) => {
      setSelectionStart({ x: e.clientX, y: e.clientY });
      setSelectionEnd({ x: e.clientX, y: e.clientY });
      document.removeEventListener('mousedown', handleSelectionStart);
    };

    document.addEventListener('mousedown', handleSelectionStart);

    toast({
      title: "Snippet Selection Active",
      description: "Click and drag to select an area to capture"
    });
  };

  // Create snippet from selection
  const createSnippet = () => {
    const x = Math.min(selectionStart.x, selectionEnd.x);
    const y = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    if (width > 10 && height > 10) {
      const newSnippet: SnippetArea = {
        id: `snippet-${Date.now()}`,
        x,
        y,
        width,
        height,
        title: `Snippet ${snippets.length + 1}`,
        timestamp: Date.now()
      };

      saveSnippets([...snippets, newSnippet]);

      toast({
        title: "Snippet Captured",
        description: `Area captured: ${width}x${height}px`
      });
    }

    document.body.style.cursor = 'default';
    setSelectionStart({ x: 0, y: 0 });
    setSelectionEnd({ x: 0, y: 0 });
  };

  // Download snippets report
  const downloadSnippetsReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      snippets: snippets.map(snippet => ({
        ...snippet,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }))
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-snippets-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Report Downloaded",
      description: `Downloaded ${snippets.length} snippets`
    });
  };

  // Clear all snippets
  const clearSnippets = () => {
    saveSnippets([]);
    toast({
      title: "Snippets Cleared",
      description: "All snippets have been removed"
    });
  };

  const buttonVariant = issueCount > 0 ? "destructive" : "secondary";

  return (
    <>
      {/* Main floating button */}
      <div
        ref={buttonRef}
        className="fixed z-[9999] cursor-move"
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
      >
        <Card className="p-2 shadow-lg border-2 bg-background/95 backdrop-blur-sm">
          <div className="flex flex-col gap-2 items-center">
            <div className="flex items-center gap-1">
              <Move className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Drag</span>
            </div>
            
            <Button
              variant={buttonVariant}
              size="sm"
              onClick={onRunTest}
              className="relative"
            >
              <TestTube className="h-4 w-4 mr-1" />
              Test
              {issueCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1 text-xs">
                  {issueCount}
                </Badge>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSnippetTool(!showSnippetTool)}
            >
              <Crop className="h-4 w-4 mr-1" />
              Snippet
            </Button>

            {showSnippetTool && (
              <Card className="absolute left-full ml-2 top-0 p-2 min-w-[200px] z-10">
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startSnippetSelection}
                  >
                    <Crop className="h-4 w-4 mr-1" />
                    Select Area
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSnippets(!showSnippets)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Show ({snippets.length})
                  </Button>

                  {snippets.length > 0 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadSnippetsReport}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearSnippets}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Clear All
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            )}
          </div>
        </Card>
      </div>

      {/* Selection overlay */}
      {isSelecting && (
        <div
          className="fixed inset-0 z-[9998] pointer-events-none"
          style={{
            background: 'rgba(0, 0, 0, 0.1)'
          }}
        >
          <div
            className="absolute border-2 border-primary bg-primary/20"
            style={{
              left: Math.min(selectionStart.x, selectionEnd.x),
              top: Math.min(selectionStart.y, selectionEnd.y),
              width: Math.abs(selectionEnd.x - selectionStart.x),
              height: Math.abs(selectionEnd.y - selectionStart.y)
            }}
          />
        </div>
      )}

      {/* Snippet overlays */}
      {showSnippets && snippets.map((snippet) => (
        <div
          key={snippet.id}
          className="fixed z-[9997] border-2 border-yellow-400 bg-yellow-400/20 pointer-events-none"
          style={{
            left: snippet.x,
            top: snippet.y,
            width: snippet.width,
            height: snippet.height
          }}
        >
          <div className="absolute -top-6 left-0 bg-yellow-400 text-black px-2 py-1 text-xs rounded">
            {snippet.title}
          </div>
        </div>
      ))}
    </>
  );
};