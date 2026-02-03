import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  ChevronUp,
  ChevronDown,
  GripVertical,
  RotateCw,
  Trash2,
  Plus,
  Loader2,
} from 'lucide-react';
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
} from '@/components/ui/dropdown-menu';

export interface PageThumbnail {
  pageNumber: number;
  imageUrl: string;
  rotation: number;
  width: number;
  height: number;
}

interface PageThumbnailsProps {
  pages: PageThumbnail[];
  currentPage: number;
  onPageSelect: (pageNumber: number) => void;
  onPageReorder?: (fromIndex: number, toIndex: number) => void;
  onPageRotate?: (pageNumber: number, degrees: number) => void;
  onPageDelete?: (pageNumber: number) => void;
  onPageAdd?: (afterPage: number) => void;
  loading?: boolean;
  editable?: boolean;
}

/**
 * Page Thumbnails Component
 * 
 * Displays thumbnail previews of all PDF pages with:
 * - Click to navigate
 * - Drag to reorder (when editable)
 * - Rotate individual pages
 * - Delete pages
 * - Add blank pages
 */
export const PageThumbnails: React.FC<PageThumbnailsProps> = ({
  pages,
  currentPage,
  onPageSelect,
  onPageReorder,
  onPageRotate,
  onPageDelete,
  onPageAdd,
  loading = false,
  editable = true,
}) => {
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [dragOverPage, setDragOverPage] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, pageNumber: number) => {
    if (!editable) return;
    setDraggedPage(pageNumber);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(pageNumber));
  }, [editable]);

  const handleDragOver = useCallback((e: React.DragEvent, pageNumber: number) => {
    if (!editable || draggedPage === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPage(pageNumber);
  }, [editable, draggedPage]);

  const handleDragLeave = useCallback(() => {
    setDragOverPage(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetPageNumber: number) => {
    e.preventDefault();
    if (!editable || draggedPage === null || !onPageReorder) return;
    
    if (draggedPage !== targetPageNumber) {
      const fromIndex = pages.findIndex(p => p.pageNumber === draggedPage);
      const toIndex = pages.findIndex(p => p.pageNumber === targetPageNumber);
      if (fromIndex !== -1 && toIndex !== -1) {
        onPageReorder(fromIndex, toIndex);
      }
    }
    
    setDraggedPage(null);
    setDragOverPage(null);
  }, [editable, draggedPage, onPageReorder, pages]);

  const handleDragEnd = useCallback(() => {
    setDraggedPage(null);
    setDragOverPage(null);
  }, []);

  if (loading) {
    return (
      <div className="w-32 bg-muted/50 border-r flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-32 bg-muted/30 border-r flex flex-col">
      <div className="px-2 py-2 border-b bg-background">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Pages ({pages.length})
        </h3>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {pages.map((page) => (
            <div
              key={page.pageNumber}
              className={cn(
                "relative group rounded-md overflow-hidden transition-all cursor-pointer",
                currentPage === page.pageNumber
                  ? "ring-2 ring-primary ring-offset-2"
                  : "ring-1 ring-border hover:ring-primary/50",
                dragOverPage === page.pageNumber && draggedPage !== page.pageNumber
                  ? "ring-2 ring-primary ring-dashed"
                  : "",
                draggedPage === page.pageNumber ? "opacity-50" : ""
              )}
              onClick={() => onPageSelect(page.pageNumber)}
              draggable={editable}
              onDragStart={(e) => handleDragStart(e, page.pageNumber)}
              onDragOver={(e) => handleDragOver(e, page.pageNumber)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, page.pageNumber)}
              onDragEnd={handleDragEnd}
            >
              {/* Thumbnail Image */}
              <div 
                className="bg-background"
                style={{
                  transform: `rotate(${page.rotation}deg)`,
                }}
              >
                <img
                  src={page.imageUrl}
                  alt={`Page ${page.pageNumber}`}
                  className="w-full h-auto"
                  loading="lazy"
                />
              </div>

              {/* Page Number Badge */}
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-background/90 text-xs px-2 py-0.5 rounded-full font-medium">
                {page.pageNumber}
              </div>

              {/* Drag Handle */}
              {editable && (
                <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>
              )}

              {/* Actions Menu */}
              {editable && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {onPageRotate && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onPageRotate(page.pageNumber, 90);
                          }}
                        >
                          <RotateCw className="h-4 w-4 mr-2" />
                          Rotate 90°
                        </DropdownMenuItem>
                      )}
                      {onPageAdd && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onPageAdd(page.pageNumber);
                          }}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add page after
                        </DropdownMenuItem>
                      )}
                      {onPageDelete && pages.length > 1 && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onPageDelete(page.pageNumber);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete page
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Quick Navigation */}
      <div className="p-2 border-t bg-background flex gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7"
              onClick={() => onPageSelect(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous Page</TooltipContent>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7"
              onClick={() => onPageSelect(Math.min(pages.length, currentPage + 1))}
              disabled={currentPage >= pages.length}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next Page</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

export default PageThumbnails;
