import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Folder, Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TemplateItemCard } from './TemplateItemCard';
import type { TemplateGroup, TemplateItem } from './hooks/useTemplateEditor';

interface TemplateItemGroupProps {
  group: TemplateGroup;
  profitMargin: number;
  selectedItemId: string | null;
  onSelectItem: (item: TemplateItem) => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteGroup: () => void;
  onAddItem: () => void;
  isUngrouped?: boolean;
}

export const TemplateItemGroup = ({
  group,
  profitMargin,
  selectedItemId,
  onSelectItem,
  onDeleteItem,
  onDeleteGroup,
  onAddItem,
  isUngrouped = false,
}: TemplateItemGroupProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, disabled: isUngrouped });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        border rounded-lg bg-card overflow-hidden
        ${isDragging ? 'opacity-50 shadow-lg' : ''}
      `}
    >
      {/* Group Header */}
      <div className="flex items-center gap-2 p-3 bg-muted/50 border-b">
        {!isUngrouped && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          >
            <GripVertical className="h-5 w-5" />
          </button>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <Folder className="h-5 w-5 text-muted-foreground" />
        <span className="font-medium flex-1">{group.name}</span>
        <span className="text-sm text-muted-foreground">
          {group.items.length} item{group.items.length !== 1 ? 's' : ''}
        </span>

        {!isUngrouped && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDeleteGroup}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Group Content */}
      {isExpanded && (
        <div className="p-3 space-y-2">
          <SortableContext
            items={group.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {group.items.map((item) => (
              <TemplateItemCard
                key={item.id}
                item={item}
                profitMargin={profitMargin}
                isSelected={selectedItemId === item.id}
                onSelect={() => onSelectItem(item)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
          </SortableContext>

          {/* Add Item Button */}
          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={onAddItem}
          >
            <Plus className="h-4 w-4 mr-2" />
            ADD MATERIAL OR LABOR TO GROUP
          </Button>
        </div>
      )}
    </div>
  );
};
