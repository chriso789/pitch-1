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
  Eye,
  EyeOff,
  Settings,
  Layers
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DeveloperToolbarProps {
  className?: string;
}

type EditMode = 'none' | 'select' | 'move' | 'code' | 'delete';

export const DeveloperToolbar = ({ className }: DeveloperToolbarProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
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
    // Add event listeners for element selection
    document.addEventListener('click', handleElementClick);
    document.addEventListener('mouseover', handleElementHover);
    document.addEventListener('mouseout', handleElementMouseOut);
    
    // Add overlay styles
    const style = document.createElement('style');
    style.id = 'developer-edit-styles';
    style.textContent = `
      .dev-selectable {
        outline: 2px dashed hsl(var(--primary)) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        position: relative !important;
      }
      .dev-selected {
        outline: 3px solid hsl(var(--destructive)) !important;
        outline-offset: 2px !important;
        background: hsla(var(--destructive), 0.1) !important;
      }
      .dev-hover {
        outline: 2px solid hsl(var(--primary)) !important;
        outline-offset: 2px !important;
      }
      .dev-moveable {
        cursor: move !important;
      }
      .dev-deletable {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);

    // Make elements selectable
    makeElementsSelectable();
  };

  const disableEditMode = () => {
    document.removeEventListener('click', handleElementClick);
    document.removeEventListener('mouseover', handleElementHover);
    document.removeEventListener('mouseout', handleElementMouseOut);
    
    // Remove overlay styles
    const style = document.getElementById('developer-edit-styles');
    if (style) {
      style.remove();
    }

    // Remove selection classes
    document.querySelectorAll('.dev-selectable, .dev-selected, .dev-hover').forEach(el => {
      el.classList.remove('dev-selectable', 'dev-selected', 'dev-hover');
    });

    setSelectedElement(null);
  };

  const makeElementsSelectable = () => {
    // Target common UI elements but exclude the developer toolbar itself
    const selectors = [
      'button:not([data-dev-toolbar])',
      '.card',
      'nav',
      'header',
      'main > div',
      '[role="button"]',
      '.flex',
      '.grid'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        // Skip if it's part of the developer toolbar
        if (el.closest('[data-dev-toolbar]')) return;
        
        el.classList.add('dev-selectable');
        
        // Add specific cursor based on edit mode
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

    // Remove previous selection
    document.querySelectorAll('.dev-selected').forEach(el => {
      el.classList.remove('dev-selected');
    });

    // Select new element
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
    // Simple drag functionality
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let elementX = 0;
    let elementY = 0;

    const htmlElement = element as HTMLElement;
    htmlElement.style.position = 'relative';
    htmlElement.style.zIndex = '1000';

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = htmlElement.getBoundingClientRect();
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
    // Show element info and allow inline editing
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
        "fixed bottom-6 right-6 z-50 transition-all duration-300",
        className
      )}
      data-dev-toolbar="true"
    >
      {!isExpanded ? (
        <Button
          onClick={() => setIsExpanded(true)}
          className="h-12 w-12 rounded-full shadow-lg gradient-primary hover:scale-110 transition-transform"
          data-dev-toolbar="true"
        >
          <Edit3 className="h-6 w-6 text-white" />
        </Button>
      ) : (
        <Card className="p-4 shadow-xl min-w-[280px]" data-dev-toolbar="true">
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
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {tools.map((tool) => (
              <Button
                key={tool.mode}
                variant={editMode === tool.mode ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode(editMode === tool.mode ? 'none' : tool.mode)}
                className="flex flex-col gap-1 h-auto p-3"
                data-dev-toolbar="true"
              >
                <tool.icon className="h-4 w-4" />
                <span className="text-xs">{tool.label}</span>
              </Button>
            ))}
          </div>

          {editMode !== 'none' && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Eye className="h-3 w-3" />
                <span>
                  {editMode === 'select' && 'Click elements to inspect them'}
                  {editMode === 'move' && 'Click and drag elements to move them'}
                  {editMode === 'code' && 'Click elements to edit their content'}
                  {editMode === 'delete' && 'Click elements to delete them'}
                </span>
              </div>
            </div>
          )}

          {selectedElement && (
            <div className="mt-4 p-3 bg-primary/10 rounded-lg border">
              <div className="text-xs font-medium text-primary mb-1">Selected Element</div>
              <div className="text-xs text-muted-foreground">
                {selectedElement.tagName.toLowerCase()}
                {selectedElement.className && ` .${selectedElement.className.split(' ').join('.')}`}
                {selectedElement.id && ` #${selectedElement.id}`}
              </div>
            </div>
          )}

          <div className="mt-4 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setEditMode('none');
                toast({
                  title: "Changes Saved",
                  description: "Layout changes have been applied.",
                });
              }}
              data-dev-toolbar="true"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};