import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Package, Wrench, Plus, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LibraryItem {
  id: string;
  item_name: string;
  description: string;
  unit: string;
  unit_cost: number;
  qty_formula: string;
  item_type: 'material' | 'labor';
  manufacturer?: string;
}

interface AddFromLibraryDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  onAddItems: (items: Array<{
    item_category: string;
    item_name: string;
    description: string;
    quantity: number;
    unit_cost: number;
    unit_type: string;
    markup_percent: number;
  }>) => void;
  measurementTags?: Record<string, number>;
}

export const AddFromLibraryDialog: React.FC<AddFromLibraryDialogProps> = ({
  open,
  onClose,
  tenantId,
  onAddItems,
  measurementTags = {},
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'material' | 'labor'>('material');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      fetchLibraryItems();
      setSelectedIds(new Set());
      setSearchQuery('');
    }
  }, [open, tenantId]);

  const fetchLibraryItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('estimate_calc_template_items')
        .select('id, item_name, description, unit, unit_cost, qty_formula, item_type, manufacturer')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('item_name');

      if (error) throw error;
      setItems((data || []) as LibraryItem[]);
    } catch (error) {
      console.error('Error fetching library items:', error);
      toast({
        title: 'Error',
        description: 'Failed to load library items',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const evaluateFormula = (formula: string): number => {
    if (!formula || !formula.includes('{{')) return 1;
    
    let expr = formula.replace(/\{\{|\}\}/g, '').trim();
    
    // Replace tag references with values
    Object.entries(measurementTags).forEach(([key, value]) => {
      expr = expr.replace(new RegExp(key.replace('.', '\\.'), 'g'), String(value));
    });
    
    // Safe eval
    try {
      const fn = new Function('ceil', 'floor', 'round', 'max', 'min', `return (${expr});`);
      return fn(Math.ceil, Math.floor, Math.round, Math.max, Math.min);
    } catch {
      return 1;
    }
  };

  const handleAddSelected = () => {
    const selectedItems = items.filter((item) => selectedIds.has(item.id));
    
    const mappedItems = selectedItems.map((item) => ({
      item_category: item.item_type,
      item_name: item.item_name,
      description: item.description || '',
      quantity: evaluateFormula(item.qty_formula),
      unit_cost: item.unit_cost,
      unit_type: item.unit,
      markup_percent: 25, // Default markup
    }));

    onAddItems(mappedItems);
    toast({
      title: 'Items Added',
      description: `Added ${mappedItems.length} item(s) to estimate`,
    });
    onClose();
  };

  const filteredItems = items.filter((item) => {
    const matchesTab = item.item_type === activeTab;
    const matchesSearch = 
      item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (item.manufacturer?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Items from Library
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'material' | 'labor')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="material" className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Materials ({items.filter((i) => i.item_type === 'material').length})
              </TabsTrigger>
              <TabsTrigger value="labor" className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Labor ({items.filter((i) => i.item_type === 'labor').length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="material" className="mt-4">
              <ItemList
                items={filteredItems}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                loading={loading}
                formatCurrency={formatCurrency}
              />
            </TabsContent>

            <TabsContent value="labor" className="mt-4">
              <ItemList
                items={filteredItems}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                loading={loading}
                formatCurrency={formatCurrency}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} item(s) selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleAddSelected} disabled={selectedIds.size === 0}>
              <Plus className="h-4 w-4 mr-2" />
              Add Selected ({selectedIds.size})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ItemList: React.FC<{
  items: LibraryItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  loading: boolean;
  formatCurrency: (amount: number) => string;
}> = ({ items, selectedIds, onToggle, loading, formatCurrency }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No items found. Try a different search or check your templates.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedIds.has(item.id)
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted/50'
            }`}
            onClick={() => onToggle(item.id)}
          >
            <Checkbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={() => onToggle(item.id)}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{item.item_name}</span>
                {item.manufacturer && (
                  <Badge variant="outline" className="text-xs">
                    {item.manufacturer}
                  </Badge>
                )}
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {item.description}
                </p>
              )}
            </div>
            <div className="text-right">
              <span className="font-semibold text-sm">{formatCurrency(item.unit_cost)}</span>
              <p className="text-xs text-muted-foreground">/{item.unit}</p>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};
