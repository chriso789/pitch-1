import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Edit3, 
  Move, 
  Trash2, 
  Code, 
  MousePointer, 
  Save, 
  X,
  Settings,
  Undo2,
  RotateCcw,
  ChevronRight,
  ChevronLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface CollapsibleDeveloperToolbarProps {
  className?: string;
}

type EditMode = 'none' | 'select' | 'move' | 'code' | 'delete';

interface ElementChange {
  element: HTMLElement;
  originalStyles: {
    position: string;
    left: string;
    top: string;
    zIndex: string;
  };
  timestamp: number;
}

export const CollapsibleDeveloperToolbar = ({ className }: CollapsibleDeveloperToolbarProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [changeHistory, setChangeHistory] = useState<ElementChange[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    checkDeveloperStatus();
  }, []);

  useEffect(() => {
    if (editMode !== 'none') {
      enableEditMode();
    } else {
      disableEditMode();
    }

    return () => disableEditMode();
  }, [editMode]);

  const saveChange = (element: HTMLElement) => {
    const change: ElementChange = {
      element,
      originalStyles: {
        position: element.style.position || '',
        left: element.style.left || '',
        top: element.style.top || '',
        zIndex: element.style.zIndex || '',
      },
      timestamp: Date.now()
    };
    setChangeHistory(prev => [...prev, change]);
  };

  const undoLastChange = () => {
    if (changeHistory.length === 0) {
      toast({
        title: "Nothing to Undo",
        description: "No changes to revert.",
        variant: "destructive"
      });
      return;
    }

    const lastChange = changeHistory[changeHistory.length - 1];
    const { element, originalStyles } = lastChange;

    element.style.position = originalStyles.position;
    element.style.left = originalStyles.left;
    element.style.top = originalStyles.top;
    element.style.zIndex = originalStyles.zIndex;

    setChangeHistory(prev => prev.slice(0, -1));
    toast({
      title: "Change Undone",
      description: "Last modification has been reverted.",
    });
  };

  const restartAll = () => {
    if (changeHistory.length === 0) {
      toast({
        title: "Nothing to Reset",
        description: "No changes to restart.",
        variant: "destructive"
      });
      return;
    }

    changeHistory.forEach(({ element, originalStyles }) => {
      element.style.position = originalStyles.position;
      element.style.left = originalStyles.left;
      element.style.top = originalStyles.top;
      element.style.zIndex = originalStyles.zIndex;
    });

    setChangeHistory([]);
    toast({
      title: "Layout Reset",
      description: "All changes have been reverted.",
    });
  };

  const checkDeveloperStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_developer')
          .eq('id', user.id)
          .single();
        
        const developerStatus = profile?.is_developer || false;
        setIsDeveloper(developerStatus);
        setIsVisible(developerStatus);
      }
    } catch (error) {
      console.error('Error checking developer status:', error);
    }
  };

  const enableEditMode = () => {
    document.addEventListener('click', handleElementClick);
    document.addEventListener('mouseover', handleElementHover);
    document.addEventListener('mouseout', handleElementMouseOut);
    
    const style = document.createElement('style');
    style.id = 'developer-edit-styles-left';
    style.textContent = `
      .dev-selectable {
        outline: 2px dashed hsl(var(--primary)) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        position: relative !important;
        transition: all 0.2s ease !important;
      }
      .dev-selectable:before {
        content: '';
        position: absolute !important;
        top: -4px !important;
        left: -4px !important;
        right: -4px !important;
        bottom: -4px !important;
        background: hsla(var(--primary), 0.05) !important;
        border: 1px solid hsl(var(--primary)) !important;
        border-radius: 4px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.2s ease !important;
        z-index: 999 !important;
      }
      .dev-selected {
        outline: 3px solid hsl(var(--destructive)) !important;
        outline-offset: 2px !important;
        background: hsla(var(--destructive), 0.1) !important;
        box-shadow: 0 0 0 4px hsla(var(--destructive), 0.2) !important;
      }
      .dev-selected:before {
        opacity: 1 !important;
        border-color: hsl(var(--destructive)) !important;
        background: hsla(var(--destructive), 0.1) !important;
      }
      .dev-hover {
        outline: 2px solid hsl(var(--primary)) !important;
        outline-offset: 2px !important;
      }
      .dev-hover:before {
        opacity: 1 !important;
      }
      .dev-moveable {
        cursor: move !important;
      }
      .dev-deletable {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);

    makeElementsSelectable();
  };

  const disableEditMode = () => {
    document.removeEventListener('click', handleElementClick);
    document.removeEventListener('mouseover', handleElementHover);
    document.removeEventListener('mouseout', handleElementMouseOut);
    
    const style = document.getElementById('developer-edit-styles-left');
    if (style) {
      style.remove();
    }

    document.querySelectorAll('.dev-selectable, .dev-selected, .dev-hover').forEach(el => {
      el.classList.remove('dev-selectable', 'dev-selected', 'dev-hover');
    });

    setSelectedElement(null);
  };

  const makeElementsSelectable = () => {
    const selectors = [
      'button:not([data-dev-toolbar])',
      '.card',
      '.flex > *:not([data-dev-toolbar])',
      '.grid > *:not([data-dev-toolbar])',
      'nav *:not([data-dev-toolbar])',
      'header *:not([data-dev-toolbar])',
      'main > div > *:not([data-dev-toolbar])',
      '[role="button"]:not([data-dev-toolbar])',
      'input:not([data-dev-toolbar])',
      'textarea:not([data-dev-toolbar])',
      'div[class*="container"]:not([data-dev-toolbar]) > *',
      'section:not([data-dev-toolbar]) > *',
      'article:not([data-dev-toolbar]) > *'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (el.closest('[data-dev-toolbar]')) return;
        if (el.parentElement?.classList.contains('dev-selectable')) return;
        
        el.classList.add('dev-selectable');
        
        if (editMode === 'move') {
          el.classList.add('dev-moveable');
        } else if (editMode === 'delete') {
          el.classList.add('dev-deletable');
        }
      });
    });
  };

  const handleElementClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target as Element;
    if (target.closest('[data-dev-toolbar]')) return;

    document.querySelectorAll('.dev-selected').forEach(el => {
      el.classList.remove('dev-selected');
    });

    const selectableElement = target.closest('.dev-selectable');
    if (selectableElement) {
      selectableElement.classList.add('dev-selected');
      setSelectedElement(selectableElement);

      if (editMode === 'delete') {
        handleDeleteElement(selectableElement);
      } else if (editMode === 'move') {
        handleMoveElement(selectableElement);
      } else if (editMode === 'code') {
        handleCodeElement(selectableElement);
      }
    }
  };

  const handleElementHover = (e: MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('[data-dev-toolbar]')) return;

    const selectableElement = target.closest('.dev-selectable');
    if (selectableElement && !selectableElement.classList.contains('dev-selected')) {
      selectableElement.classList.add('dev-hover');
    }
  };

  const handleElementMouseOut = (e: MouseEvent) => {
    const target = e.target as Element;
    const selectableElement = target.closest('.dev-selectable');
    if (selectableElement) {
      selectableElement.classList.remove('dev-hover');
    }
  };

  const handleDeleteElement = (element: Element) => {
    if (confirm('Are you sure you want to delete this element?')) {
      element.remove();
      setSelectedElement(null);
      toast({
        title: "Element Deleted",
        description: "The selected element has been removed.",
      });
    }
  };

  const handleMoveElement = (element: Element) => {
    const htmlElement = element as HTMLElement;
    
    saveChange(htmlElement);
    
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let elementX = 0;
    let elementY = 0;

    htmlElement.style.position = 'relative';
    htmlElement.style.zIndex = '1000';

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      elementX = parseInt(htmlElement.style.left) || 0;
      elementY = parseInt(htmlElement.style.top) || 0;
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      htmlElement.style.left = `${elementX + deltaX}px`;
      htmlElement.style.top = `${elementY + deltaY}px`;
    };

    const handleMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      toast({
        title: "Element Moved",
        description: "Element position has been updated.",
      });
    };

    htmlElement.addEventListener('mousedown', handleMouseDown);
  };

  const handleCodeElement = (element: Element) => {
    const tagName = element.tagName.toLowerCase();
    const classList = Array.from(element.classList).join(' ');
    const id = element.id;
    
    const info = `
Tag: ${tagName}
Classes: ${classList || 'none'}
ID: ${id || 'none'}
Content: ${element.textContent?.substring(0, 100) || 'none'}...
    `;

    const newContent = prompt(`Element Information:\n${info}\n\nEdit text content:`, element.textContent || '');
    if (newContent !== null) {
      element.textContent = newContent;
      toast({
        title: "Element Updated",
        description: "Element content has been modified.",
      });
    }
  };

  const tools = [
    {
      mode: 'select' as EditMode,
      icon: MousePointer,
      label: 'Select',
      description: 'Select elements to inspect'
    },
    {
      mode: 'move' as EditMode,
      icon: Move,
      label: 'Move',
      description: 'Drag elements to reposition'
    },
    {
      mode: 'code' as EditMode,
      icon: Code,
      label: 'Code',
      description: 'Edit element content'
    },
    {
      mode: 'delete' as EditMode,
      icon: Trash2,
      label: 'Delete',
      description: 'Remove elements'
    }
  ];

  if (!isVisible || !isDeveloper) return null;

  return (
    <div 
      className={cn(
        "fixed left-0 top-1/2 -translate-y-1/2 z-50 transition-all duration-300",
        className
      )}
      data-dev-toolbar="true"
    >
      {!isExpanded ? (
        <Button
          onClick={() => setIsExpanded(true)}
          className="h-12 w-12 rounded-r-full shadow-lg gradient-primary hover:scale-110 transition-transform"
          data-dev-toolbar="true"
        >
          <ChevronRight className="h-6 w-6 text-white" />
        </Button>
      ) : (
        <Card className="p-4 shadow-xl min-w-[280px] ml-0 rounded-l-none" data-dev-toolbar="true">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge variant="destructive" className="text-xs">DEV</Badge>
              <span className="font-medium text-sm">Layout Editor</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsExpanded(false);
                setEditMode('none');
              }}
              data-dev-toolbar="true"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {tools.map((tool) => (
              <Button
                key={tool.mode}
                variant={editMode === tool.mode ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode(editMode === tool.mode ? 'none' : tool.mode)}
                className="flex flex-col items-center gap-1 h-auto py-2"
                data-dev-toolbar="true"
              >
                <tool.icon className="h-4 w-4" />
                <span className="text-xs">{tool.label}</span>
              </Button>
            ))}
          </div>

          {editMode !== 'none' && (
            <div className="mb-4 p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">
                {tools.find(t => t.mode === editMode)?.description}
              </p>
              {selectedElement && (
                <p className="text-xs mt-1 font-mono">
                  Selected: {selectedElement.tagName.toLowerCase()}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={undoLastChange}
              disabled={changeHistory.length === 0}
              className="flex-1"
              data-dev-toolbar="true"
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={restartAll}
              disabled={changeHistory.length === 0}
              className="flex-1"
              data-dev-toolbar="true"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              toast({
                title: "Changes Saved",
                description: "Developer changes have been applied.",
              });
            }}
            className="w-full"
            data-dev-toolbar="true"
          >
            <Save className="h-3 w-3 mr-1" />
            Save Changes
          </Button>
        </Card>
      )}
    </div>
  );
};