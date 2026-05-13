import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ArrowUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export type ColumnSortKey =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'score_desc'
  | 'score_asc'
  | 'rep_asc';

export const COLUMN_SORT_OPTIONS: { key: ColumnSortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name_asc', label: 'Name (A–Z)' },
  { key: 'name_desc', label: 'Name (Z–A)' },
  { key: 'score_desc', label: 'Lead score (high → low)' },
  { key: 'score_asc', label: 'Lead score (low → high)' },
  { key: 'rep_asc', label: 'Assigned rep (A–Z)' },
];

interface ContactKanbanColumnProps {
  id: string;
  title: string;
  color: string;
  count: number;
  children: React.ReactNode;
  items?: string[];
  sortKey?: ColumnSortKey;
  onSortChange?: (key: ColumnSortKey) => void;
}

export const ContactKanbanColumn: React.FC<ContactKanbanColumnProps> = ({
  id,
  title,
  color,
  count,
  children,
  items = [],
  sortKey = 'newest',
  onSortChange,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  // Convert hex color to background style
  const colorStyle = color.startsWith('#') 
    ? { backgroundColor: color } 
    : {};

  return (
    <div className="min-w-[250px] w-[250px] flex-shrink-0 space-y-1.5">
      {/* Column Header */}
      <Card className="shadow-soft border-0">
        <CardHeader className="p-2">
          <CardTitle className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <div 
                className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                style={colorStyle}
              >
                <Users className="h-2.5 w-2.5 text-white" />
              </div>
              <span className="font-medium truncate">{title}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-muted-foreground font-normal text-[9px]">
                {count}
              </span>
              {onSortChange && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      title="Sort column"
                    >
                      <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 z-50 bg-popover">
                    <DropdownMenuLabel className="text-xs">Sort by</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {COLUMN_SORT_OPTIONS.map((opt) => (
                      <DropdownMenuItem
                        key={opt.key}
                        onClick={() => onSortChange(opt.key)}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-3 w-3",
                            sortKey === opt.key ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Drop Zone */}
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[400px] max-h-[calc(100vh-340px)] overflow-y-auto p-1.5 rounded-lg transition-colors",
            isOver 
              ? "bg-primary/10 border-2 border-primary border-dashed" 
              : "bg-muted/20 border-2 border-transparent"
          )}
        >
          <div className="space-y-1.5">
            {children}
          </div>
        </div>
      </SortableContext>
    </div>
  );
};
