import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { type LineItem } from '@/hooks/useEstimatePricing';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';

interface UpdateTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItems: LineItem[];
}

interface TemplateOption {
  id: string;
  name: string;
  roof_type?: string | null;
  template_category?: string | null;
  itemCount: number;
}

export const UpdateTemplateDialog: React.FC<UpdateTemplateDialogProps> = ({
  open,
  onOpenChange,
  lineItems,
}) => {
  const { toast } = useToast();
  const { activeTenantId } = useActiveTenantId();
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (open && activeTenantId) {
      fetchTemplates();
    }
  }, [open, activeTenantId]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      // Fetch templates
      const { data: tpls, error } = await (supabase as any)
        .from('estimate_calculation_templates')
        .select('id, name, roof_type, template_category')
        .eq('tenant_id', activeTenantId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      // Fetch item counts for each template
      const templateIds = (tpls || []).map((t: any) => t.id);
      const { data: items } = await (supabase as any)
        .from('estimate_calc_template_items')
        .select('calc_template_id')
        .in('calc_template_id', templateIds)
        .eq('active', true);

      const countMap = new Map<string, number>();
      (items || []).forEach((item: any) => {
        countMap.set(item.calc_template_id, (countMap.get(item.calc_template_id) || 0) + 1);
      });

      setTemplates(
        (tpls || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          roof_type: t.roof_type,
          template_category: t.template_category,
          itemCount: countMap.get(t.id) || 0,
        }))
      );
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast({ title: 'Failed to load templates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedTemplateId || !activeTenantId) return;

    setUpdating(true);
    try {
      // 1. Delete existing template items for this template
      const { error: deleteError } = await (supabase as any)
        .from('estimate_calc_template_items')
        .delete()
        .eq('calc_template_id', selectedTemplateId)
        .eq('tenant_id', activeTenantId);

      if (deleteError) throw deleteError;

      // 2. Insert new items from current estimate (without qty values - use formula placeholders)
      const itemsToInsert = lineItems
        .filter(item => item.item_type !== 'change_order')
        .map((item, idx) => ({
          calc_template_id: selectedTemplateId,
          tenant_id: activeTenantId,
          item_name: item.item_name,
          item_type: item.item_type,
          qty_formula: '1', // Don't carry over quantities - user sets per estimate
          unit: item.unit,
          unit_cost: item.unit_cost,
          sort_order: item.sort_order ?? idx,
          description: item.description || null,
          active: true,
          measurement_type: null,
          ...(item.trade_type ? { } : {}),
        }));

      if (itemsToInsert.length > 0) {
        const { error: insertError } = await (supabase as any)
          .from('estimate_calc_template_items')
          .insert(itemsToInsert);

        if (insertError) throw insertError;
      }

      const templateName = templates.find(t => t.id === selectedTemplateId)?.name;
      toast({
        title: 'Template Updated',
        description: `"${templateName}" now has ${itemsToInsert.length} line items with updated unit costs.`,
      });

      onOpenChange(false);
      setSelectedTemplateId(null);
    } catch (err: any) {
      console.error('Error updating template:', err);
      toast({
        title: 'Update Failed',
        description: err.message || 'Could not update template',
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
    }
  };

  const materialCount = lineItems.filter(i => i.item_type === 'material').length;
  const laborCount = lineItems.filter(i => i.item_type === 'labor').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Update Template from Estimate</DialogTitle>
          <DialogDescription>
            Push the current line items (names, units, unit costs) to an existing template.
            Quantities will NOT be carried over — they are set per estimate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Current items summary */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-2">
            <FileText className="h-4 w-4" />
            <span>{materialCount} materials, {laborCount} labor items will be saved</span>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>This will replace ALL existing items in the selected template with the current estimate's line items.</span>
          </div>

          {/* Template list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading templates...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No templates found. Create a template first.
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-1">
                {templates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-md border text-left transition-colors ${
                      selectedTemplateId === template.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{template.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {template.itemCount} items
                        {template.roof_type && ` · ${template.roof_type}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {template.template_category && (
                        <Badge variant="secondary" className="text-xs">
                          {template.template_category}
                        </Badge>
                      )}
                      {selectedTemplateId === template.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={!selectedTemplateId || updating}
          >
            {updating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
