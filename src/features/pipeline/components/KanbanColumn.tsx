import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Clock, X } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  minDays?: string;
  onMinDaysChange?: (value: string) => void;
  filteredCount?: number;
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
  minDays = '',
  onMinDaysChange,
  filteredCount,
}) => {
  const { isOver, setNodeRef } = useDroppable({ id });
  const hasFilter = !!minDays;

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
              <span className="text-muted-foreground">
                {hasFilter && filteredCount !== undefined ? `${filteredCount}/${count}` : count}
              </span>
              <div className="flex items-center gap-0.5">
                <TrendingUp className="h-2.5 w-2.5 text-success" />
                <span className="font-semibold text-success text-[9px]">{total}</span>
              </div>
            </div>
            {onMinDaysChange && (
              <div className="flex items-center gap-1 w-full mt-1">
                <Clock className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                <Input
                  type="number"
                  min={0}
                  placeholder="Min days in status"
                  value={minDays}
                  onChange={(e) => onMinDaysChange(e.target.value)}
                  className="h-5 px-1 text-[9px] flex-1"
                  title="Show only cards that have been in this status at least N days"
                />
                {hasFilter && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 p-0 flex-shrink-0"
                    onClick={() => onMinDaysChange('')}
                    title="Clear filter"
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                )}
              </div>
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
