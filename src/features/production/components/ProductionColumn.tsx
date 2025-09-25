import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductionColumnProps {
  id: string;
  title: string;
  color: string;
  icon: React.ComponentType<any>;
  count: number;
  total: string;
  children: React.ReactNode;
}

export const ProductionColumn: React.FC<ProductionColumnProps> = ({
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

  // Convert hex color to Tailwind-compatible background
  const getBackgroundColor = (colorStr: string) => {
    if (colorStr.includes('#ef4444')) return 'bg-red-500';
    if (colorStr.includes('#f97316')) return 'bg-orange-500';
    if (colorStr.includes('#eab308')) return 'bg-yellow-500';
    if (colorStr.includes('#3b82f6')) return 'bg-blue-500';
    if (colorStr.includes('#8b5cf6')) return 'bg-violet-500';
    if (colorStr.includes('#10b981')) return 'bg-emerald-500';
    if (colorStr.includes('#06b6d4')) return 'bg-cyan-500';
    if (colorStr.includes('#6b7280')) return 'bg-gray-500';
    return 'bg-blue-500'; // fallback
  };

  return (
    <div className="space-y-4">
      {/* Column Header */}
      <Card className="shadow-soft border-0">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center", getBackgroundColor(color))}>
                <Icon className="h-3 w-3 text-white" />
              </div>
              <div>
                <div className="font-medium">{title}</div>
                <div className="text-xs font-normal text-muted-foreground">
                  {count} projects
                </div>
              </div>
            </div>
            {/* Total Value */}
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
          "max-w-full",
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