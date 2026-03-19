// Sectioned line items table with Materials and Labor sections
import React, { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Package, 
  Hammer, 
  Pencil, 
  Check, 
  X, 
  RotateCcw,
  Trash2,
  Receipt,
  Plus,
  StickyNote,
  GripVertical
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LineItem } from '@/hooks/useEstimatePricing';
import { MaterialAutocomplete } from './MaterialAutocomplete';

interface SectionedLineItemsTableProps {
  materialItems: LineItem[];
  laborItems: LineItem[];
  materialsTotal: number;
  laborTotal: number;
  onUpdateItem: (id: string, updates: Partial<LineItem>) => void;
  onDeleteItem?: (id: string) => void;
  onResetItem?: (id: string) => void;
  onAddItem?: (type: 'material' | 'labor') => void;
  onAddTradeItem?: (tradeType: string, type: 'material' | 'labor') => void;
  /** Active trade types declared by the parent — ensures multi-trade layout even for trades with zero items */
  activeTrades?: Array<{ type: string; label: string }>;
  editable?: boolean;
  // Sales tax from company settings (read-only)
  salesTaxEnabled?: boolean;
  salesTaxRate?: number;
  salesTaxAmount?: number;
  // Pre-calculated selling price and total with tax from pricing breakdown
  sellingPrice?: number;
  totalWithTax?: number;
  className?: string;
  // Inline add item form props
  isAddingItem?: boolean;
  addingItemType?: 'material' | 'labor';
  addingTradeType?: string;
  newItem?: { item_name: string; qty: number; unit: string; unit_cost: number; notes?: string; material_id?: string };
  onNewItemChange?: (item: { item_name: string; qty: number; unit: string; unit_cost: number; notes?: string; material_id?: string }) => void;
  onSaveNewItem?: () => void;
  onCancelAddItem?: () => void;
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
  onAddItem,
  onAddTradeItem,
  activeTrades,
  editable = true,
  salesTaxEnabled = false,
  salesTaxRate = 0,
  salesTaxAmount = 0,
  sellingPrice,
  totalWithTax,
  className = '',
  isAddingItem = false,
  addingItemType,
  addingTradeType,
  newItem,
  onNewItemChange,
  onSaveNewItem,
  onCancelAddItem,
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

  // Component for note editing popover
  const NoteEditor = ({ item }: { item: LineItem }) => {
    const [noteValue, setNoteValue] = useState(item.notes || '');
    const [open, setOpen] = useState(false);
    
    const handleSave = () => {
      onUpdateItem(item.id, { notes: noteValue });
      setOpen(false);
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-5 w-5 shrink-0 ${
              item.notes 
                ? 'text-amber-500 opacity-100' 
                : 'opacity-0 group-hover:opacity-50'
            }`}
            title={item.notes ? 'Edit note' : 'Add note'}
          >
            <StickyNote className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Color / Notes</Label>
            <Textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder="e.g. Charcoal, 26 gauge"
              className="min-h-[60px] text-sm"
            />
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // Inline description editor
  const DescriptionEditor = ({ item }: { item: LineItem }) => {
    const [descValue, setDescValue] = useState(item.description || '');
    const [editing, setEditing] = useState(false);

    if (editing) {
      return (
        <div className="flex flex-col gap-1 mt-0.5">
          <Textarea
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            className="text-xs min-h-[60px] py-1 px-2"
            rows={3}
            autoFocus
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onUpdateItem(item.id, { description: descValue });
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
          />
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { onUpdateItem(item.id, { description: descValue }); setEditing(false); }}>
              <Check className="h-3 w-3 text-green-600" />
            </Button>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditing(false)}>
              <X className="h-3 w-3 text-red-600" />
            </Button>
          </div>
        </div>
      );
    }

    if (item.description && item.description !== item.item_name) {
      return (
        <p
          className="text-xs text-muted-foreground mt-0.5 cursor-pointer hover:text-foreground"
          onClick={() => editable && setEditing(true)}
        >
          {item.description}
        </p>
      );
    }

    if (editable) {
      return (
        <p
          className="text-xs text-muted-foreground/50 mt-0.5 cursor-pointer hover:text-muted-foreground opacity-0 group-hover:opacity-100 italic"
          onClick={() => setEditing(true)}
        >
          + Add description
        </p>
      );
    }

    return null;
  };

  const renderItemRow = (item: LineItem) => (
    <TableRow key={item.id} className="group">
      <TableCell className="font-medium">
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="truncate">{item.item_name}</span>
              {item.is_override && (
                <Badge variant="outline" className="text-xs shrink-0">Modified</Badge>
              )}
              {editable && <NoteEditor item={item} />}
            </div>
            <DescriptionEditor item={item} />
            {item.notes && (
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="text-amber-600 font-medium">Color/Specs:</span> {item.notes}
              </p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right">
        {renderEditableCell(item, 'qty', item.qty, `${Number(item.qty.toFixed(2))} ${item.unit}`)}
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

  // Group items by trade_type if multi-trade items are present
  const hasMultipleTrades = useMemo(() => {
    // If parent declares multiple active trades, use that (even if some have zero items)
    if (activeTrades && activeTrades.length > 1) return true;
    const allItems = [...materialItems, ...laborItems];
    const tradeTypes = new Set(allItems.map(i => i.trade_type).filter(Boolean));
    return tradeTypes.size > 1;
  }, [materialItems, laborItems, activeTrades]);

  // Get unique trade groups in order
  const tradeGroups = useMemo(() => {
    if (!hasMultipleTrades) return null;
    const allItems = [...materialItems, ...laborItems];
    const seen = new Map<string, string>(); // trade_type -> trade_label
    // Start with activeTrades from parent to ensure all trades are represented
    if (activeTrades) {
      activeTrades.forEach(t => seen.set(t.type, t.label));
    }
    allItems.forEach(item => {
      if (item.trade_type && !seen.has(item.trade_type)) {
        seen.set(item.trade_type, item.trade_label || item.trade_type);
      }
    });
    return Array.from(seen.entries()).map(([type, label]) => ({
      type,
      label,
      materials: materialItems.filter(i => i.trade_type === type),
      labor: laborItems.filter(i => i.trade_type === type),
    }));
  }, [hasMultipleTrades, materialItems, laborItems]);

  const TRADE_ICONS: Record<string, string> = {
    roofing: '🏠',
    gutters: '🔧',
    siding: '🧱',
    interior: '🏗️',
    exterior: '🔨',
  };

  const renderTradeHeader = (tradeType: string, tradeLabel: string) => (
    <TableRow className="bg-accent/30 hover:bg-accent/30 border-t-2 border-accent">
      <TableCell colSpan={editable ? 5 : 4} className="py-2">
        <div className="flex items-center gap-2 font-bold text-sm">
          <span>{TRADE_ICONS[tradeType] || '📋'}</span>
          <span className="uppercase tracking-wide">{tradeLabel}</span>
        </div>
      </TableCell>
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
          {/* Multi-trade layout: group by trade, then materials/labor within each */}
          {hasMultipleTrades && tradeGroups ? (
            <>
              {tradeGroups.map(group => (
                <React.Fragment key={group.type}>
                  {renderTradeHeader(group.type, group.label)}
                  
                  {/* Materials for this trade */}
                  {group.materials.length > 0 && (
                    <>
                      {renderSectionHeader(
                        'MATERIALS',
                        <Package className="h-4 w-4" />,
                        group.materials.length
                      )}
                      {group.materials.map(renderItemRow)}
                      {renderSectionSubtotal(
                        'Materials Subtotal',
                        group.materials.reduce((sum, i) => sum + i.line_total, 0)
                      )}
                    </>
                  )}

                  {/* Labor for this trade */}
                  {group.labor.length > 0 && (
                    <>
                      {renderSectionHeader(
                        'LABOR',
                        <Hammer className="h-4 w-4" />,
                        group.labor.length
                      )}
                      {group.labor.map(renderItemRow)}
                      {renderSectionSubtotal(
                        'Labor Subtotal',
                        group.labor.reduce((sum, i) => sum + i.line_total, 0)
                      )}
                    </>
                  )}

                  {/* Per-trade Add Item buttons */}
                  {editable && onAddTradeItem && (
                    <TableRow className="hover:bg-muted/30">
                      <TableCell colSpan={editable ? 5 : 4} className="py-2">
                        <div className="flex gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => onAddTradeItem(group.type, 'material')}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Material Item
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => onAddTradeItem(group.type, 'labor')}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Labor Item
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {/* Inline Add Form for this trade */}
                  {isAddingItem && addingTradeType === group.type && newItem && onNewItemChange && (
                    <TableRow className="bg-primary/5 border-2 border-primary/30">
                      <TableCell colSpan={editable ? 5 : 4} className="py-3">
                        <div className="flex items-end gap-2 flex-wrap">
                          <div className="flex-1 min-w-[200px]">
                            <Label className="text-xs">Item Name ({addingItemType === 'material' ? 'Material' : 'Labor'})</Label>
                            <MaterialAutocomplete
                              value={newItem.item_name}
                              onChange={(value) => onNewItemChange({ ...newItem, item_name: value })}
                              onSelectMaterial={(material) => {
                                onNewItemChange({
                                  ...newItem,
                                  item_name: material.name,
                                  unit: material.uom,
                                  unit_cost: material.base_cost,
                                  material_id: material.id,
                                });
                              }}
                              placeholder="Search items..."
                              autoFocus
                            />
                          </div>
                          <div className="w-32">
                            <Label className="text-xs">Notes</Label>
                            <Input
                              value={newItem.notes || ''}
                              onChange={(e) => onNewItemChange({ ...newItem, notes: e.target.value })}
                              placeholder="e.g. details"
                            />
                          </div>
                          <div className="w-20">
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number"
                              value={newItem.qty}
                              onChange={(e) => onNewItemChange({ ...newItem, qty: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="w-16">
                            <Label className="text-xs">Unit</Label>
                            <Input
                              value={newItem.unit}
                              onChange={(e) => onNewItemChange({ ...newItem, unit: e.target.value })}
                              placeholder="ea"
                            />
                          </div>
                          <div className="w-24">
                            <Label className="text-xs">Unit Cost</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={newItem.unit_cost}
                              onChange={(e) => onNewItemChange({ ...newItem, unit_cost: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                          <Button onClick={onSaveNewItem} size="sm">
                            <Check className="h-4 w-4 mr-1" />
                            Add
                          </Button>
                          <Button variant="ghost" size="sm" onClick={onCancelAddItem}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </>
          ) : (
            <>
              {/* Single-trade layout (original) */}
              {/* Materials Section */}
              {renderSectionHeader(
                'MATERIALS',
                <Package className="h-4 w-4" />,
                materialItems.length
              )}
              {materialItems.map(renderItemRow)}
              {editable && onAddItem && (
                <TableRow className="hover:bg-muted/30">
                  <TableCell colSpan={editable ? 5 : 4} className="py-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => onAddItem('material')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Material Item
                    </Button>
                  </TableCell>
                </TableRow>
              )}
              {/* Inline Add Material Form */}
              {isAddingItem && addingItemType === 'material' && newItem && onNewItemChange && (
                <TableRow className="bg-primary/5 border-2 border-primary/30">
                  <TableCell colSpan={editable ? 5 : 4} className="py-3">
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <Label className="text-xs">Item Name</Label>
                        <MaterialAutocomplete
                          value={newItem.item_name}
                          onChange={(value) => onNewItemChange({ ...newItem, item_name: value })}
                          onSelectMaterial={(material) => {
                            onNewItemChange({
                              ...newItem,
                              item_name: material.name,
                              unit: material.uom,
                              unit_cost: material.base_cost,
                              material_id: material.id,
                            });
                          }}
                          placeholder="Search materials..."
                          autoFocus
                        />
                      </div>
                      <div className="w-32">
                        <Label className="text-xs">Color / Specs</Label>
                        <Input
                          value={newItem.notes || ''}
                          onChange={(e) => onNewItemChange({ ...newItem, notes: e.target.value })}
                          placeholder="e.g. Charcoal"
                        />
                      </div>
                      <div className="w-20">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          value={newItem.qty}
                          onChange={(e) => onNewItemChange({ ...newItem, qty: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="w-16">
                        <Label className="text-xs">Unit</Label>
                        <Input
                          value={newItem.unit}
                          onChange={(e) => onNewItemChange({ ...newItem, unit: e.target.value })}
                          placeholder="ea"
                        />
                      </div>
                      <div className="w-24">
                        <Label className="text-xs">Unit Cost</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={newItem.unit_cost}
                          onChange={(e) => onNewItemChange({ ...newItem, unit_cost: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <Button onClick={onSaveNewItem} size="sm">
                        <Check className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                      <Button variant="ghost" size="sm" onClick={onCancelAddItem}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {materialItems.length > 0 && renderSectionSubtotal('Materials Subtotal', materialsTotal)}

              {/* Labor Section */}
              {renderSectionHeader(
                'LABOR',
                <Hammer className="h-4 w-4" />,
                laborItems.length
              )}
              {laborItems.map(renderItemRow)}
              {editable && onAddItem && (
                <TableRow className="hover:bg-muted/30">
                  <TableCell colSpan={editable ? 5 : 4} className="py-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => onAddItem('labor')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Labor Item
                    </Button>
                  </TableCell>
                </TableRow>
              )}
              {/* Inline Add Labor Form */}
              {isAddingItem && addingItemType === 'labor' && newItem && onNewItemChange && (
                <TableRow className="bg-primary/5 border-2 border-primary/30">
                  <TableCell colSpan={editable ? 5 : 4} className="py-3">
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label className="text-xs">Item Name</Label>
                        <MaterialAutocomplete
                          value={newItem.item_name}
                          onChange={(value) => onNewItemChange({ ...newItem, item_name: value })}
                          onSelectMaterial={(material) => {
                            onNewItemChange({
                              ...newItem,
                              item_name: material.name,
                              unit: material.uom,
                              unit_cost: material.base_cost,
                              material_id: material.id,
                            });
                          }}
                          placeholder="Search items..."
                          autoFocus
                        />
                      </div>
                      <div className="w-32">
                        <Label className="text-xs">Notes</Label>
                        <Input
                          value={newItem.notes || ''}
                          onChange={(e) => onNewItemChange({ ...newItem, notes: e.target.value })}
                          placeholder="e.g. details"
                        />
                      </div>
                      <div className="w-20">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          value={newItem.qty}
                          onChange={(e) => onNewItemChange({ ...newItem, qty: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="w-16">
                        <Label className="text-xs">Unit</Label>
                        <Input
                          value={newItem.unit}
                          onChange={(e) => onNewItemChange({ ...newItem, unit: e.target.value })}
                          placeholder="ea"
                        />
                      </div>
                      <div className="w-24">
                        <Label className="text-xs">Unit Cost</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={newItem.unit_cost}
                          onChange={(e) => onNewItemChange({ ...newItem, unit_cost: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <Button onClick={onSaveNewItem} size="sm">
                        <Check className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                      <Button variant="ghost" size="sm" onClick={onCancelAddItem}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {laborItems.length > 0 && renderSectionSubtotal('Labor Subtotal', laborTotal)}
            </>
          )}

          {/* Empty State */}
          {materialItems.length === 0 && laborItems.length === 0 && !onAddItem && (
            <TableRow>
              <TableCell colSpan={editable ? 5 : 4} className="text-center py-8 text-muted-foreground">
                No line items. Select a template to populate items.
              </TableCell>
            </TableRow>
          )}

          {/* Direct Cost Total */}
          {(materialItems.length > 0 || laborItems.length > 0) && (
            <>
              <TableRow className="bg-primary/5 hover:bg-primary/5 border-t-2">
                <TableCell colSpan={editable ? 3 : 3} className="text-right font-semibold text-lg">
                  Direct Cost Total
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-lg">
                  {formatCurrency(materialsTotal + laborTotal)}
                </TableCell>
                {editable && <TableCell />}
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
