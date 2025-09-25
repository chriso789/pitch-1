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
      {/* Column Header */}
      <Card className="shadow-soft border-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", color)}>
              <Icon className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <div>{title}</div>
              <div className="font-normal text-muted-foreground">
                {count} items
              </div>
              {/* Dollar Amount Ticker */}
              <div className="flex items-center gap-1 mt-1">
                <TrendingUp className="h-3 w-3 text-success" />
                <span className="text-xs font-semibold text-success">
                  {total}
                </span>
              </div>
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