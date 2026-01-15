import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CalcTemplateItem } from './hooks/useCalcTemplateEditor';
import { usePricingCalculation } from './hooks/usePricingCalculation';

interface CalcTemplateItemCardProps {
  item: CalcTemplateItem;
  profitMargin: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export const CalcTemplateItemCard: React.FC<CalcTemplateItemCardProps> = ({
  item,
  profitMargin,
  isSelected,
  onSelect,
  onDelete,
}) => {
  const { calculatePrice, formatCurrency } = usePricingCalculation();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const pricing = calculatePrice(item.unit_cost, profitMargin, 'profit_margin');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md border transition-colors',
        'hover:bg-accent/50',
        isDragging && 'opacity-50',
        isSelected && 'ring-2 ring-primary bg-primary/5',
        item.item_type === 'labor' && 'border-l-2 border-l-orange-400'
      )}
    >
      <button
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0" onClick={onSelect}>
        <p className="font-medium truncate cursor-pointer">{item.item_name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{item.unit}</span>
          <span>•</span>
          <span>Cost: {formatCurrency(item.unit_cost)}</span>
          <span>•</span>
          <span>Price: {formatCurrency(pricing.price)}</span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onSelect}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
