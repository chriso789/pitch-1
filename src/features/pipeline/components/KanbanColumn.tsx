import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ArrowDownWideNarrow, ArrowUpWideNarrow, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  icon: React.ComponentType<any>;
  count: number;
  total: string;
  children: React.ReactNode;
  items?: string[];
  sortDir?: 'asc' | 'desc';
  onToggleSort?: () => void;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  title,
  color,
  icon: Icon,
  count,
  total,
  children,
  items = [],
  sortDir,
  onToggleSort,
}) => {
  const { isOver, setNodeRef } = useDroppable({ id });

  const SortIcon = sortDir === 'asc' ? ArrowUpWideNarrow : sortDir === 'desc' ? ArrowDownWideNarrow : ArrowUpDown;
  const sortLabel = sortDir === 'asc'
    ? 'Days in status: ascending'
    : sortDir === 'desc'
    ? 'Days in status: descending'
    : 'Sort by days in status';

  return (
    <div className="space-y-2">
      <Card className="shadow-soft border-0">
        <CardHeader className="p-2">
          <CardTitle className="flex flex-col items-center gap-1 text-xs">
            <div className="flex items-center gap-1.5 w-full justify-center">
              <div className={cn("w-4 h-4 rounded-full flex items-center justify-center", color)}>
                <Icon className="h-2.5 w-2.5 text-white" />
              </div>
              <div className="text-[10px] font-medium text-center truncate">{title}</div>
            </div>
            <div className="flex items-center justify-between w-full text-[9px]">
              <span className="text-muted-foreground">{count}</span>
              <div className="flex items-center gap-0.5">
                <TrendingUp className="h-2.5 w-2.5 text-success" />
                <span className="font-semibold text-success text-[9px]">{total}</span>
              </div>
            </div>
            {onToggleSort && (
              <Button
                variant={sortDir ? "secondary" : "ghost"}
                size="sm"
                onClick={onToggleSort}
                title={sortLabel}
                className="h-6 w-full px-1.5 text-[9px] gap-1 font-normal"
              >
                <SortIcon className="h-3 w-3" />
                <span className="truncate">
                  {sortDir === 'asc' ? 'Days ↑' : sortDir === 'desc' ? 'Days ↓' : 'Sort by days'}
                </span>
              </Button>
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[400px] p-1.5 rounded-lg transition-colors overflow-hidden",
            "max-w-full",
            isOver ? "bg-primary/10 border-2 border-primary border-dashed" : "bg-muted/20 border-2 border-transparent"
          )}
        >
          <div className="space-y-2 w-full">
            {children}
          </div>
        </div>
      </SortableContext>
    </div>
  );
};
