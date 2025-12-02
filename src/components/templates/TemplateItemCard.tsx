import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePricingCalculation } from './hooks/usePricingCalculation';
import type { TemplateItem } from './hooks/useTemplateEditor';

interface TemplateItemCardProps {
  item: TemplateItem;
  profitMargin: number;
  onSelect: () => void;
  onDelete: () => void;
  isSelected: boolean;
}

export const TemplateItemCard = ({
  item,
  profitMargin,
  onSelect,
  onDelete,
  isSelected,
}: TemplateItemCardProps) => {
  const { calculatePrice, formatCurrency } = usePricingCalculation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const pricing = calculatePrice(
    item.unit_cost,
    profitMargin,
    item.pricing_type,
    item.fixed_price ?? undefined
  );

  const borderColor = item.item_type === 'labor' ? 'border-l-purple-500' : 'border-l-blue-500';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-3 bg-card border rounded-lg border-l-4 ${borderColor}
        ${isDragging ? 'opacity-50 shadow-lg' : ''}
        ${isSelected ? 'ring-2 ring-primary' : ''}
        hover:bg-accent/50 transition-colors cursor-pointer
      `}
      onClick={onSelect}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-5 w-5" />
      </button>

      {/* Item Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {item.estimate_item_name || item.name}
          </span>
          {item.measurement_type && (
            <span className="text-xs text-muted-foreground">
              ({item.measurement_type === 'roof_area' ? 'SQ' : 'LF'})
            </span>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {formatCurrency(item.unit_cost)} / {item.unit}
        </div>
      </div>

      {/* Price Display */}
      <div className="text-right">
        <div className="text-lg font-bold text-primary">
          {formatCurrency(pricing.price)}
        </div>
        <div className="text-xs text-muted-foreground">per {item.unit}</div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          <Edit2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
