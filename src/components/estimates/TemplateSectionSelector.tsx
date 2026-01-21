import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Loader2, Lock, CheckCircle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { format } from 'date-fns';
import { LaborOrderExport } from '@/components/orders/LaborOrderExport';
import { MaterialLineItemsExport } from '@/components/orders/MaterialLineItemsExport';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface LineItem {
  id: string;
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
}

interface TemplateSectionSelectorProps {
  pipelineEntryId: string;
  sectionType: 'material' | 'labor';
  onTotalChange?: (total: number) => void;
  isLocked?: boolean;
  lockedAt?: string | null;
  lockedByName?: string | null;
  onLockSuccess?: () => void;
}

export const TemplateSectionSelector: React.FC<TemplateSectionSelectorProps> = ({
  pipelineEntryId,
  sectionType,
  onTotalChange,
  isLocked = false,
  lockedAt,
  lockedByName,
  onLockSuccess
}) => {
  const queryClient = useQueryClient();
  const { profile } = useUserProfile();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [isCreatingEstimate, setIsCreatingEstimate] = useState(false);

  // Fetch templates for this tenant
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['estimate-templates', sectionType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('id, name, template_category, base_material_cost_per_sq, base_labor_rate_per_hour')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data || [];
    }
  });

  // First fetch the selected_estimate_id from pipeline_entries metadata
  const { data: pipelineData, isLoading: pipelineDataLoading } = useQuery({
    queryKey: ['pipeline-selected-estimate', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      
      if (error) throw error;
      console.log('[TemplateSectionSelector] Pipeline metadata loaded:', data?.metadata);
      return data;
    },
    staleTime: 0, // Always refetch to get latest selected_estimate_id
    refetchOnMount: 'always'
  });

  // Use effectiveEstimateId: prefer selected_estimate_id, fallback to enhanced_estimate_id
  const metadata = pipelineData?.metadata as any;
  const effectiveEstimateId = metadata?.selected_estimate_id ?? metadata?.enhanced_estimate_id;

  // Fetch existing estimate to get saved line items - using effectiveEstimateId
  const { data: existingEstimate, isLoading: estimateLoading } = useQuery({
    queryKey: ['enhanced-estimate-items', pipelineEntryId, effectiveEstimateId, sectionType],
    queryFn: async () => {
      if (!effectiveEstimateId) return null;
      
      console.log('[TemplateSectionSelector] Fetching estimate:', effectiveEstimateId, 'for section:', sectionType);
      
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items, template_id, material_cost_locked_at, labor_cost_locked_at')
        .eq('id', effectiveEstimateId)
        .single();
      
      if (error) throw error;
      console.log('[TemplateSectionSelector] Estimate loaded:', { id: data?.id, hasLineItems: !!data?.line_items });
      return data;
    },
    enabled: !!effectiveEstimateId,
    staleTime: 0, // Always consider stale so it refetches
    refetchOnMount: 'always' // Always refetch when component mounts
  });

  // Track loading state
  const isLoadingData = pipelineDataLoading || (!!effectiveEstimateId && estimateLoading);

  // Load line items when estimate data changes - using useEffect for proper state management
  useEffect(() => {
    console.log('[TemplateSectionSelector] useEffect triggered:', {
      hasEstimate: !!existingEstimate,
      estimateId: existingEstimate?.id,
      hasLineItems: !!existingEstimate?.line_items,
      sectionType,
      effectiveEstimateId
    });
    
    if (existingEstimate?.line_items) {
      const items = existingEstimate.line_items as unknown as Record<string, any[]>;
      // Check both possible keys: 'materials'/'labor' and 'material'/'labor'
      const primaryKey = sectionType === 'material' ? 'materials' : 'labor';
      const fallbackKey = sectionType === 'material' ? 'material' : 'labor';
      const rawSectionItems = items[primaryKey] || items[fallbackKey];
      
      console.log('[TemplateSectionSelector] Line items found:', {
        primaryKey,
        fallbackKey,
        itemCount: rawSectionItems?.length || 0,
        keys: Object.keys(items)
      });
      
      if (rawSectionItems && rawSectionItems.length > 0) {
        // Normalize line items - handle qty_original/unit_cost_original fallbacks
        const normalizedItems: LineItem[] = rawSectionItems.map((item: any) => {
          const qty = (item.qty > 0 ? item.qty : (item.qty_original ?? 0));
          const unitCost = (item.unit_cost > 0 ? item.unit_cost : (item.unit_cost_original ?? 0));
          const lineTotal = (item.line_total > 0 ? item.line_total : (qty * unitCost));
          
          return {
            id: item.id || crypto.randomUUID(),
            item_name: item.item_name || item.name || 'Unknown Item',
            qty: qty,
            unit: item.unit || 'ea',
            unit_cost: unitCost,
            line_total: lineTotal
          };
        });
        
        setLineItems(normalizedItems);
      }
    }
    
    if (existingEstimate?.template_id) {
      setSelectedTemplateId(existingEstimate.template_id);
    }
  }, [existingEstimate?.id, existingEstimate?.line_items, existingEstimate?.template_id, sectionType, effectiveEstimateId]);

  // Save line items mutation
  const saveLineItemsMutation = useMutation({
    mutationFn: async (items: LineItem[]) => {
      const sectionKey = sectionType === 'material' ? 'materials' : 'labor';
      const costKey = sectionType === 'material' ? 'material_cost' : 'labor_cost';
      const total = items.reduce((sum, item) => sum + item.line_total, 0);

      // Use the effectiveEstimateId - this is the canonical source
      if (!effectiveEstimateId) {
        throw new Error('No estimate selected. Please select an estimate first.');
      }

      // Get existing line items from the selected estimate to preserve the other section
      const { data: existing, error: fetchError } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items, material_cost, labor_cost')
        .eq('id', effectiveEstimateId)
        .single();

      if (fetchError) throw fetchError;
      if (!existing) throw new Error('Selected estimate not found');

      const existingLineItems = (existing?.line_items as unknown as Record<string, LineItem[]>) || {};
      const updatedLineItems = {
        ...existingLineItems,
        [sectionKey]: items
      } as unknown as Record<string, unknown>;

      // Calculate new selling price
      const materialCost = sectionType === 'material' ? total : (existing?.material_cost || 0);
      const laborCost = sectionType === 'labor' ? total : (existing?.labor_cost || 0);
      const costPreProfit = materialCost + laborCost;
      const sellingPrice = costPreProfit / 0.7; // 30% margin

      // Always update the selected estimate by ID
      const { error } = await supabase
        .from('enhanced_estimates')
        .update({
          line_items: updatedLineItems as any,
          [costKey]: total,
          selling_price: sellingPrice,
          template_id: selectedTemplateId || null
        })
        .eq('id', effectiveEstimateId);
      if (error) throw error;

      return total;
    },
    onSuccess: (total) => {
      // Invalidate all estimate-related queries for cache synchronization
      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-costs', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['cost-lock-status', pipelineEntryId] });
      onTotalChange?.(total);
      toast.success('Line items saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save: ${error.message}`);
    }
  });

  // Handle template selection - load default line items
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates?.find(t => t.id === templateId);
    
    if (template) {
      // Create default line items based on template
      const defaultItems: LineItem[] = sectionType === 'material' 
        ? [
            { id: crypto.randomUUID(), item_name: 'Shingles (bundles)', qty: 45, unit: 'bundle', unit_cost: template.base_material_cost_per_sq / 3, line_total: 45 * (template.base_material_cost_per_sq / 3) },
            { id: crypto.randomUUID(), item_name: 'Underlayment', qty: 6, unit: 'roll', unit_cost: 85, line_total: 510 },
            { id: crypto.randomUUID(), item_name: 'Starter Strip', qty: 12, unit: 'bundle', unit_cost: 35, line_total: 420 },
            { id: crypto.randomUUID(), item_name: 'Ridge Cap', qty: 8, unit: 'bundle', unit_cost: 52, line_total: 416 },
            { id: crypto.randomUUID(), item_name: 'Drip Edge', qty: 20, unit: 'stick', unit_cost: 8, line_total: 160 },
          ]
        : [
            { id: crypto.randomUUID(), item_name: 'Tear Off', qty: 15, unit: 'sq', unit_cost: 45, line_total: 675 },
            { id: crypto.randomUUID(), item_name: 'Underlayment Install', qty: 15, unit: 'sq', unit_cost: 15, line_total: 225 },
            { id: crypto.randomUUID(), item_name: 'Shingle Install', qty: 15, unit: 'sq', unit_cost: template.base_labor_rate_per_hour * 1.3, line_total: 15 * template.base_labor_rate_per_hour * 1.3 },
            { id: crypto.randomUUID(), item_name: 'Ridge/Hip Work', qty: 48, unit: 'lf', unit_cost: 3.50, line_total: 168 },
            { id: crypto.randomUUID(), item_name: 'Cleanup & Haul', qty: 1, unit: 'job', unit_cost: 350, line_total: 350 },
          ];
      
      setLineItems(defaultItems);
      saveLineItemsMutation.mutate(defaultItems);
    }
  };

  // Update a line item
  const handleUpdateItem = (id: string, field: keyof LineItem, value: number | string) => {
    const updatedItems = lineItems.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Recalculate line total
        if (field === 'qty' || field === 'unit_cost') {
          updated.line_total = updated.qty * updated.unit_cost;
        }
        return updated;
      }
      return item;
    });
    setLineItems(updatedItems);
  };

  // Remove a line item
  const handleRemoveItem = (id: string) => {
    const filtered = lineItems.filter(item => item.id !== id);
    setLineItems(filtered);
    saveLineItemsMutation.mutate(filtered);
  };

  // Create estimate if none exists, then add item
  const handleCreateEstimateAndAddItem = async () => {
    if (!profile?.tenant_id) {
      toast.error('Unable to determine tenant');
      return;
    }

    setIsCreatingEstimate(true);
    try {
      // Create a new enhanced_estimate for this pipeline entry
      const { data: newEstimate, error: createError } = await supabase
        .from('enhanced_estimates')
        .insert({
          pipeline_entry_id: pipelineEntryId,
          tenant_id: profile.tenant_id,
          status: 'draft',
          line_items: { materials: [], labor: [] }
        } as any)
        .select()
        .single();

      if (createError) throw createError;

      // Update pipeline entry metadata with the new estimate ID
      const { data: pipelineEntry } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      const existingMetadata = (pipelineEntry?.metadata as Record<string, any>) || {};
      
      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            selected_estimate_id: newEstimate.id,
            enhanced_estimate_id: newEstimate.id
          }
        })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      // Invalidate queries to refresh the estimate data
      queryClient.invalidateQueries({ queryKey: ['pipeline-selected-estimate', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
      
      toast.success('Estimate created');
      
      // Now show the add item form
      setIsAddingItem(true);
    } catch (error: any) {
      console.error('Error creating estimate:', error);
      toast.error(error.message || 'Failed to create estimate');
    } finally {
      setIsCreatingEstimate(false);
    }
  };

  // Add new item
  const handleAddItem = async () => {
    if (!newItem.item_name) return;

    // If no estimate exists, create one first
    if (!effectiveEstimateId) {
      await handleCreateEstimateAndAddItem();
      return;
    }
    
    const item: LineItem = {
      id: crypto.randomUUID(),
      item_name: newItem.item_name,
      qty: newItem.qty,
      unit: newItem.unit,
      unit_cost: newItem.unit_cost,
      line_total: newItem.qty * newItem.unit_cost
    };
    
    const updatedItems = [...lineItems, item];
    setLineItems(updatedItems);
    saveLineItemsMutation.mutate(updatedItems);
    setNewItem({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
    setIsAddingItem(false);
  };

  // Save current items
  const handleSave = () => {
    saveLineItemsMutation.mutate(lineItems);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const sectionTotal = lineItems.reduce((sum, item) => sum + item.line_total, 0);

  return (
    <div className="space-y-4">
      {/* Template Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-muted-foreground mb-1 block">
            Select {sectionType === 'material' ? 'Material' : 'Labor'} Template
          </label>
          <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a template..." />
            </SelectTrigger>
            <SelectContent>
              {templatesLoading ? (
                <SelectItem value="loading" disabled>Loading...</SelectItem>
              ) : templates?.length === 0 ? (
                <SelectItem value="none" disabled>No templates available</SelectItem>
              ) : (
                templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} 
                    <span className="text-muted-foreground ml-2">
                      ({template.template_category})
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Loading State */}
      {isLoadingData && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span>Loading {sectionType === 'material' ? 'materials' : 'labor'} line items...</span>
        </div>
      )}

      {/* Line Items Table */}
      {!isLoadingData && lineItems.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Item Name</TableHead>
                <TableHead className="w-[15%] text-right">Qty</TableHead>
                <TableHead className="w-[10%]">Unit</TableHead>
                <TableHead className="w-[15%] text-right">Unit Cost</TableHead>
                <TableHead className="w-[15%] text-right">Line Total</TableHead>
                <TableHead className="w-[5%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.item_name}</TableCell>
                  <TableCell>
                    {isLocked ? (
                      <span className="text-right block">{item.qty}</span>
                    ) : (
                      <Input
                        type="number"
                        value={item.qty}
                        onChange={(e) => handleUpdateItem(item.id, 'qty', parseFloat(e.target.value) || 0)}
                        onBlur={handleSave}
                        className="h-8 text-right"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                  <TableCell>
                    {isLocked ? (
                      <span className="text-right block">{formatCurrency(item.unit_cost)}</span>
                    ) : (
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unit_cost}
                        onChange={(e) => handleUpdateItem(item.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                        onBlur={handleSave}
                        className="h-8 text-right"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(item.line_total)}
                  </TableCell>
                  <TableCell>
                    {!isLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Item Form - ALWAYS show if not locked and not loading */}
      {!isLocked && !isLoadingData && (
        isAddingItem ? (
          <div className="flex items-end gap-2 p-3 border rounded-lg bg-muted/30">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Item Name</label>
              <Input
                value={newItem.item_name}
                onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })}
                placeholder="Item name"
                className="h-8"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Qty</label>
              <Input
                type="number"
                value={newItem.qty}
                onChange={(e) => setNewItem({ ...newItem, qty: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Unit</label>
              <Input
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                className="h-8"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground">Unit Cost</label>
              <Input
                type="number"
                step="0.01"
                value={newItem.unit_cost}
                onChange={(e) => setNewItem({ ...newItem, unit_cost: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <Button onClick={handleAddItem} size="sm" disabled={isCreatingEstimate}>
              {isCreatingEstimate ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsAddingItem(false)}>Cancel</Button>
          </div>
        ) : (
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={() => {
              if (!effectiveEstimateId) {
                handleCreateEstimateAndAddItem();
              } else {
                setIsAddingItem(true);
              }
            }}
            disabled={isCreatingEstimate}
          >
            {isCreatingEstimate ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {!effectiveEstimateId ? 'Create Estimate & Add Line Item' : 'Add Line Item'}
          </Button>
        )
      )}

      {/* Section Total */}
      <div className="flex items-center justify-between pt-4 border-t">
        <span className="text-lg font-semibold">
          {sectionType === 'material' ? 'Materials' : 'Labor'} Total
        </span>
        <div className="flex items-center gap-2">
          {saveLineItemsMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {/* Export buttons */}
          {lineItems.length > 0 && sectionType === 'material' && existingEstimate?.id && (
            <MaterialLineItemsExport
              estimateId={existingEstimate.id}
              materialItems={lineItems}
              totalAmount={sectionTotal}
            />
          )}
          {lineItems.length > 0 && sectionType === 'labor' && existingEstimate?.id && (
            <LaborOrderExport
              estimateId={existingEstimate.id}
              laborItems={lineItems}
              totalAmount={sectionTotal}
            />
          )}
          <Badge variant="secondary" className="text-lg px-4 py-1">
            {formatCurrency(sectionTotal)}
          </Badge>
        </div>
      </div>

      {/* Lock Status or Lock Button */}
      {isLocked ? (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Original {sectionType === 'material' ? 'Material' : 'Labor'} Cost Locked
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {lockedAt && format(new Date(lockedAt), 'MMM d, yyyy h:mm a')}
                  {lockedByName && ` by ${lockedByName}`}
                </p>
              </div>
            </div>
            <span className="text-lg font-bold text-green-800 dark:text-green-200">
              {formatCurrency(sectionTotal)}
            </span>
          </div>
        </div>
      ) : lineItems.length > 0 ? (
        <div className="mt-4">
          <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
            <AlertDialogTrigger asChild>
              <Button 
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                disabled={lineItems.length === 0}
              >
                <Lock className="h-4 w-4 mr-2" />
                Save & Lock Original {sectionType === 'material' ? 'Material' : 'Labor'} Cost
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lock {sectionType === 'material' ? 'Material' : 'Labor'} Costs?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will lock the current {sectionType} cost of <strong>{formatCurrency(sectionTotal)}</strong> as the original baseline for cost verification.
                  <br /><br />
                  Once locked, this amount will be used to compare against actual invoices during the Final Inspection phase.
                  <br /><br />
                  <strong>This action cannot be undone.</strong>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-green-600 hover:bg-green-700"
                  onClick={async () => {
                    try {
                      // Use estimate_id directly if available, otherwise fall back to pipeline_entry_id
                      const lockPayload = existingEstimate?.id 
                        ? { estimate_id: existingEstimate.id, section: sectionType }
                        : { pipeline_entry_id: pipelineEntryId, section: sectionType };
                      
                      const { data, error } = await supabase.functions.invoke('lock-original-costs', {
                        body: lockPayload
                      });
                      if (error) throw error;
                      toast.success(data.message);
                      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
                      queryClient.invalidateQueries({ queryKey: ['cost-lock-status', pipelineEntryId] });
                      queryClient.invalidateQueries({ queryKey: ['pipeline-selected-estimate', pipelineEntryId] });
                      onLockSuccess?.();
                    } catch (error: any) {
                      toast.error(error.message || 'Failed to lock costs');
                    }
                  }}
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Lock {sectionType === 'material' ? 'Material' : 'Labor'} Cost
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
};
