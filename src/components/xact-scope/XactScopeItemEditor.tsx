import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';
import { Plus, Trash2, Sparkles, Loader2, Search } from 'lucide-react';
import { ROOFING_SCOPE_CATALOG, CATALOG_BY_CATEGORY, type CatalogItem } from './roofingScopeCatalog';

interface ScopeItem {
  id: string;
  scope_project_id: string;
  scope_area_id: string | null;
  trade: string;
  xactimate_code: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  waste_percent: number;
  tax_rate: number;
  line_total: number;
  source: string;
  confidence: number | null;
  ai_reason: string | null;
  sort_order: number;
}

interface ScopeArea {
  id: string;
  area_name: string;
}

interface XactScopeItemEditorProps {
  scopeProjectId: string;
  items: ScopeItem[];
  areas: ScopeArea[];
  defaultTaxRate: number;
}

export const XactScopeItemEditor: React.FC<XactScopeItemEditorProps> = ({
  scopeProjectId, items, areas, defaultTaxRate
}) => {
  const queryClient = useQueryClient();
  const [showCatalog, setShowCatalog] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // Manual add form
  const [manualForm, setManualForm] = useState({
    description: '',
    xactimate_code: '',
    trade: 'roofing',
    quantity: 0,
    unit: 'SQ',
    unit_price: 0,
    waste_percent: 0,
    tax_rate: defaultTaxRate,
    scope_area_id: '' as string,
  });

  const handleAddFromCatalog = async (catalogItem: CatalogItem) => {
    try {
      const { error } = await supabase.from('xact_scope_items').insert({
        scope_project_id: scopeProjectId,
        trade: catalogItem.trade,
        xactimate_code: catalogItem.xactimate_code,
        description: catalogItem.description,
        quantity: 0,
        unit: catalogItem.unit,
        unit_price: 0,
        waste_percent: catalogItem.default_waste_percent,
        tax_rate: defaultTaxRate,
        source: 'manual',
        sort_order: items.length,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
      toast({ title: 'Item added', description: catalogItem.description });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleAddManual = async () => {
    if (!manualForm.description.trim()) return;
    try {
      const { error } = await supabase.from('xact_scope_items').insert({
        scope_project_id: scopeProjectId,
        trade: manualForm.trade,
        xactimate_code: manualForm.xactimate_code || null,
        description: manualForm.description,
        quantity: manualForm.quantity,
        unit: manualForm.unit,
        unit_price: manualForm.unit_price,
        waste_percent: manualForm.waste_percent,
        tax_rate: manualForm.tax_rate,
        scope_area_id: manualForm.scope_area_id || null,
        source: 'manual',
        sort_order: items.length,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
      setShowManual(false);
      setManualForm({ description: '', xactimate_code: '', trade: 'roofing', quantity: 0, unit: 'SQ', unit_price: 0, waste_percent: 0, tax_rate: defaultTaxRate, scope_area_id: '' });
      toast({ title: 'Item added' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (itemId: string) => {
    setDeleting(itemId);
    const { error } = await supabase.from('xact_scope_items').delete().eq('id', itemId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
    }
    setDeleting(null);
  };

  const handleInlineUpdate = async (itemId: string, field: string, value: any) => {
    const { error } = await supabase
      .from('xact_scope_items')
      .update({ [field]: value })
      .eq('id', itemId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
    }
  };

  const filteredCatalog = catalogSearch
    ? ROOFING_SCOPE_CATALOG.filter(c =>
        c.description.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        c.xactimate_code.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        c.category.toLowerCase().includes(catalogSearch.toLowerCase())
      )
    : ROOFING_SCOPE_CATALOG;

  const filteredByCategory = filteredCatalog.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, CatalogItem[]>);

  // Group items by area
  const itemsByArea = items.reduce((acc, item) => {
    const key = item.scope_area_id || '__general__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, ScopeItem[]>);

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowCatalog(true)}>
          <Plus className="h-4 w-4 mr-1" /> From Catalog
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowManual(true)}>
          <Plus className="h-4 w-4 mr-1" /> Custom Item
        </Button>
        {items.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={async () => {
              if (!confirm(`Remove all ${items.length} line items? This allows re-generating from measurements.`)) return;
              const { error } = await supabase.from('xact_scope_items').delete().eq('scope_project_id', scopeProjectId);
              if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
              else {
                queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
                toast({ title: 'All items cleared' });
              }
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Clear All
          </Button>
        )}
      </div>

      {/* Items Table */}
      {!items.length ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No line items yet. Add from the roofing catalog or create a custom item.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-2 px-2">Code</th>
                <th className="text-left py-2 px-2">Description</th>
                <th className="text-left py-2 px-2">Area</th>
                <th className="text-right py-2 px-2 w-20">Qty</th>
                <th className="text-center py-2 px-2 w-16">Unit</th>
                <th className="text-right py-2 px-2 w-24">Unit $</th>
                <th className="text-right py-2 px-2 w-16">Waste%</th>
                <th className="text-right py-2 px-2 w-24">Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b hover:bg-muted/30">
                  <td className="py-1.5 px-2">
                    <span className="font-mono text-xs text-muted-foreground">{item.xactimate_code || '—'}</span>
                  </td>
                  <td className="py-1.5 px-2">
                    <span className="text-sm">{item.description}</span>
                    {item.source === 'ai_suggested' && (
                      <Badge variant="secondary" className="ml-1 text-[9px] px-1">
                        <Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI
                      </Badge>
                    )}
                  </td>
                  <td className="py-1.5 px-2">
                    <Select
                      value={item.scope_area_id || ''}
                      onValueChange={v => handleInlineUpdate(item.id, 'scope_area_id', v || null)}
                    >
                      <SelectTrigger className="h-7 text-xs w-28">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">General</SelectItem>
                        {areas.map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.area_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 px-2">
                    <Input
                      type="number"
                      className="h-7 text-xs text-right w-20"
                      value={item.quantity}
                      onChange={e => handleInlineUpdate(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="py-1.5 px-2 text-center text-xs">{item.unit}</td>
                  <td className="py-1.5 px-2">
                    <Input
                      type="number"
                      className="h-7 text-xs text-right w-24"
                      value={item.unit_price}
                      onChange={e => handleInlineUpdate(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <Input
                      type="number"
                      className="h-7 text-xs text-right w-16"
                      value={item.waste_percent}
                      onChange={e => handleInlineUpdate(item.id, 'waste_percent', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="py-1.5 px-2 text-right font-medium">${(item.line_total || 0).toFixed(2)}</td>
                  <td className="py-1.5 px-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDelete(item.id)}
                      disabled={deleting === item.id}
                    >
                      {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Catalog Dialog */}
      <Dialog open={showCatalog} onOpenChange={setShowCatalog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Roofing Scope Catalog</DialogTitle>
          </DialogHeader>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={catalogSearch}
              onChange={e => setCatalogSearch(e.target.value)}
              placeholder="Search items..."
              className="pl-9"
            />
          </div>
          <ScrollArea className="h-[50vh]">
            <div className="space-y-4">
              {Object.entries(filteredByCategory).map(([category, catItems]) => (
                <div key={category}>
                  <h4 className="text-sm font-semibold mb-2 text-muted-foreground">{category}</h4>
                  <div className="space-y-1">
                    {catItems.map(item => (
                      <div key={item.xactimate_code} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 cursor-pointer group">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{item.xactimate_code}</span>
                            <span className="text-sm">{item.description}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Unit: {item.unit} | Waste: {item.default_waste_percent}%
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleAddFromCatalog(item)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Manual Add Dialog */}
      <Dialog open={showManual} onOpenChange={setShowManual}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Custom Line Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Xactimate Code</Label>
                <Input value={manualForm.xactimate_code} onChange={e => setManualForm(f => ({ ...f, xactimate_code: e.target.value }))} placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Trade</Label>
                <Select value={manualForm.trade} onValueChange={v => setManualForm(f => ({ ...f, trade: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="roofing">Roofing</SelectItem>
                    <SelectItem value="gutter">Gutter</SelectItem>
                    <SelectItem value="siding">Siding</SelectItem>
                    <SelectItem value="interior">Interior</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={manualForm.description} onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Qty</Label>
                <Input type="number" value={manualForm.quantity} onChange={e => setManualForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Select value={manualForm.unit} onValueChange={v => setManualForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SQ">SQ</SelectItem>
                    <SelectItem value="SF">SF</SelectItem>
                    <SelectItem value="LF">LF</SelectItem>
                    <SelectItem value="EA">EA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Unit Price</Label>
                <Input type="number" value={manualForm.unit_price} onChange={e => setManualForm(f => ({ ...f, unit_price: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Waste %</Label>
                <Input type="number" value={manualForm.waste_percent} onChange={e => setManualForm(f => ({ ...f, waste_percent: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
            {areas.length > 0 && (
              <div>
                <Label className="text-xs">Area</Label>
                <Select value={manualForm.scope_area_id} onValueChange={v => setManualForm(f => ({ ...f, scope_area_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="General" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">General</SelectItem>
                    {areas.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.area_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManual(false)}>Cancel</Button>
            <Button onClick={handleAddManual} disabled={!manualForm.description.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
