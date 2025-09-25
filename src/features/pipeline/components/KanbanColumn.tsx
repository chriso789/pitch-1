import React from 'react';
import { useDroppable } from '@dnd-kit/core';
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
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  title,
  color,
  icon: Icon,
  count,
  total,
  children,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <div className="space-y-4">
      {/* Column Header - Compact horizontal layout */}
      <Card className="shadow-soft border-0">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center", color)}>
                <Icon className="h-3 w-3 text-white" />
              </div>
              <div>
                <div className="font-medium">{title}</div>
                <div className="text-xs font-normal text-muted-foreground">
                  {count} items
                </div>
              </div>
            </div>
            {/* Dollar Amount - Right aligned */}
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-success" />
              <span className="text-xs font-semibold text-success">
                {total}
              </span>
            </div>
          </CardTitle>                
        </CardHeader>
      </Card>

      {/* Drop Zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[400px] p-2 rounded-lg transition-colors overflow-hidden",
          "max-w-full", // Constrain to column width
          isOver ? "bg-primary/10 border-2 border-primary border-dashed" : "bg-muted/20 border-2 border-transparent"
        )}
      >
        <div className="space-y-3 w-full">
          {children}
        </div>
      </div>
    </div>
  );
};