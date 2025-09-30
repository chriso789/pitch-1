import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  icon: React.ComponentType<any>;
  count: number;
  total: string;
  children: React.ReactNode;
  items?: string[]; // Array of item IDs for SortableContext
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
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <div className="space-y-2">
      {/* Column Header - Ultra compact for narrow columns */}
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
          </CardTitle>                
        </CardHeader>
      </Card>

      {/* Drop Zone with SortableContext */}
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[400px] p-1.5 rounded-lg transition-colors overflow-hidden",
            "max-w-full", // Constrain to column width
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