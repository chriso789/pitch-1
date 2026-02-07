import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContactKanbanColumnProps {
  id: string;
  title: string;
  color: string;
  count: number;
  children: React.ReactNode;
  items?: string[];
}

export const ContactKanbanColumn: React.FC<ContactKanbanColumnProps> = ({
  id,
  title,
  color,
  count,
  children,
  items = [],
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  // Convert hex color to background style
  const colorStyle = color.startsWith('#') 
    ? { backgroundColor: color } 
    : {};

  return (
    <div className="space-y-1.5">
      {/* Column Header */}
      <Card className="shadow-soft border-0">
        <CardHeader className="p-2">
          <CardTitle className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <div 
                className="w-4 h-4 rounded-full flex items-center justify-center"
                style={colorStyle}
              >
                <Users className="h-2.5 w-2.5 text-white" />
              </div>
              <span className="font-medium truncate">{title}</span>
            </div>
            <span className="text-muted-foreground font-normal text-[9px]">
              {count}
            </span>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Drop Zone */}
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[400px] p-1.5 rounded-lg transition-colors",
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
