import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CalcTemplateItem, CalcTemplateGroup } from './hooks/useCalcTemplateEditor';
import { CalcTemplateItemCard } from './CalcTemplateItemCard';

interface CalcTemplateItemGroupProps {
  group: CalcTemplateGroup;
  profitMargin: number;
  selectedItemId?: string;
  onSelectItem: (item: CalcTemplateItem) => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddItem: () => void;
}

export const CalcTemplateItemGroup: React.FC<CalcTemplateItemGroupProps> = ({
  group,
  profitMargin,
  selectedItemId,
  onSelectItem,
  onDeleteItem,
  onDeleteGroup,
  onAddItem,
}) => {
  const [expanded, setExpanded] = useState(true);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isUngrouped = group.id === 'ungrouped';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-lg border bg-card',
        isDragging && 'opacity-50',
        group.group_type === 'labor' && 'border-l-4 border-l-orange-500'
      )}
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
        {!isUngrouped && (
          <button
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <button
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="font-medium">{group.name}</span>
          <span className="text-xs text-muted-foreground">
            ({group.items.length} items)
          </span>
        </button>

        {!isUngrouped && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDeleteGroup(group.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Items */}
      {expanded && (
        <div className="p-2 space-y-2">
          <SortableContext
            items={group.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {group.items.map((item) => (
              <CalcTemplateItemCard
                key={item.id}
                item={item}
                profitMargin={profitMargin}
                isSelected={item.id === selectedItemId}
                onSelect={() => onSelectItem(item)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
          </SortableContext>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={onAddItem}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
        </div>
      )}
    </div>
  );
};
