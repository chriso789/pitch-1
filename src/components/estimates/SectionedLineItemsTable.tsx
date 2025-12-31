// Sectioned line items table with Materials and Labor sections
import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Package, 
  Hammer, 
  Pencil, 
  Check, 
  X, 
  RotateCcw,
  Trash2 
} from 'lucide-react';
import type { LineItem } from '@/hooks/useEstimatePricing';

interface SectionedLineItemsTableProps {
  materialItems: LineItem[];
  laborItems: LineItem[];
  materialsTotal: number;
  laborTotal: number;
  onUpdateItem: (id: string, updates: Partial<LineItem>) => void;
  onDeleteItem?: (id: string) => void;
  onResetItem?: (id: string) => void;
  editable?: boolean;
  className?: string;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

interface EditableCell {
  itemId: string;
  field: 'qty' | 'unit_cost';
}

export function SectionedLineItemsTable({
  materialItems,
  laborItems,
  materialsTotal,
  laborTotal,
  onUpdateItem,
  onDeleteItem,
  onResetItem,
  editable = true,
  className = '',
}: SectionedLineItemsTableProps) {
  const [editingCell, setEditingCell] = useState<EditableCell | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (itemId: string, field: 'qty' | 'unit_cost', currentValue: number) => {
    setEditingCell({ itemId, field });
    setEditValue(currentValue.toString());
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = () => {
    if (!editingCell) return;
    
    const numValue = parseFloat(editValue);
    if (!isNaN(numValue) && numValue >= 0) {
      onUpdateItem(editingCell.itemId, { [editingCell.field]: numValue });
    }
    cancelEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const renderEditableCell = (
    item: LineItem, 
    field: 'qty' | 'unit_cost', 
    value: number,
    displayValue: string
  ) => {
    const isEditing = editingCell?.itemId === item.id && editingCell?.field === field;
    const isOverride = item.is_override && (
      (field === 'qty' && item.qty !== item.qty_original) ||
      (field === 'unit_cost' && item.unit_cost !== item.unit_cost_original)
    );

    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-7 w-20 text-right font-mono"
            autoFocus
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}>
            <Check className="h-3 w-3 text-green-600" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEdit}>
            <X className="h-3 w-3 text-red-600" />
          </Button>
        </div>
      );
    }

    return (
      <div 
        className={`flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 ${
          isOverride ? 'text-amber-600 font-medium' : ''
        }`}
        onClick={() => editable && startEdit(item.id, field, value)}
      >
        <span className="font-mono">{displayValue}</span>
        {editable && <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />}
      </div>
    );
  };

  const renderItemRow = (item: LineItem) => (
    <TableRow key={item.id} className="group">
      <TableCell className="font-medium">
        {item.item_name}
        {item.is_override && (
          <Badge variant="outline" className="ml-2 text-xs">Modified</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {renderEditableCell(item, 'qty', item.qty, `${item.qty} ${item.unit}`)}
      </TableCell>
      <TableCell className="text-right">
        {renderEditableCell(item, 'unit_cost', item.unit_cost, formatCurrency(item.unit_cost))}
      </TableCell>
      <TableCell className="text-right font-mono font-medium">
        {formatCurrency(item.line_total)}
      </TableCell>
      {editable && (
        <TableCell className="w-10">
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {item.is_override && onResetItem && (
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-6 w-6"
                onClick={() => onResetItem(item.id)}
                title="Reset to original"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
            {onDeleteItem && (
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-6 w-6 text-destructive"
                onClick={() => onDeleteItem(item.id)}
                title="Remove item"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );

  const renderSectionHeader = (
    title: string, 
    icon: React.ReactNode, 
    itemCount: number
  ) => (
    <TableRow className="bg-muted/50 hover:bg-muted/50">
      <TableCell colSpan={editable ? 5 : 4} className="py-2">
        <div className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-2">{itemCount}</Badge>
        </div>
      </TableCell>
    </TableRow>
  );

  const renderSectionSubtotal = (label: string, total: number) => (
    <TableRow className="bg-muted/30 hover:bg-muted/30 border-t">
      <TableCell colSpan={editable ? 3 : 3} className="text-right font-medium">
        {label}
      </TableCell>
      <TableCell className="text-right font-mono font-bold">
        {formatCurrency(total)}
      </TableCell>
      {editable && <TableCell />}
    </TableRow>
  );

  return (
    <div className={className}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Item</TableHead>
            <TableHead className="text-right w-[20%]">Qty</TableHead>
            <TableHead className="text-right w-[15%]">Unit Cost</TableHead>
            <TableHead className="text-right w-[15%]">Total</TableHead>
            {editable && <TableHead className="w-[10%]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Materials Section */}
          {materialItems.length > 0 && (
            <>
              {renderSectionHeader(
                'MATERIALS',
                <Package className="h-4 w-4" />,
                materialItems.length
              )}
              {materialItems.map(renderItemRow)}
              {renderSectionSubtotal('Materials Subtotal', materialsTotal)}
            </>
          )}

          {/* Labor Section */}
          {laborItems.length > 0 && (
            <>
              {renderSectionHeader(
                'LABOR',
                <Hammer className="h-4 w-4" />,
                laborItems.length
              )}
              {laborItems.map(renderItemRow)}
              {renderSectionSubtotal('Labor Subtotal', laborTotal)}
            </>
          )}

          {/* Empty State */}
          {materialItems.length === 0 && laborItems.length === 0 && (
            <TableRow>
              <TableCell colSpan={editable ? 5 : 4} className="text-center py-8 text-muted-foreground">
                No line items. Select a template to populate items.
              </TableCell>
            </TableRow>
          )}

          {/* Grand Total */}
          {(materialItems.length > 0 || laborItems.length > 0) && (
            <TableRow className="bg-primary/5 hover:bg-primary/5 border-t-2">
              <TableCell colSpan={editable ? 3 : 3} className="text-right font-semibold text-lg">
                Direct Cost Total
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-lg">
                {formatCurrency(materialsTotal + laborTotal)}
              </TableCell>
              {editable && <TableCell />}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
