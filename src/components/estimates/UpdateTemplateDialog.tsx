import React, { useState, useEffect, useMemo } from 'react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, FileText, Check, AlertTriangle, Plus, Pencil } from 'lucide-react';
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

type EditableItem = {
  item_name: string;
  description: string;
  item_type: 'material' | 'labor' | 'change_order';
  unit: string;
  unit_cost: number;
  quantity?: number;
  sort_order: number;
  trade_type?: string;
};

const ROOF_TYPES = ['shingle', 'metal', 'tile', 'flat', 'slate', 'cedar', 'other'] as const;

export const UpdateTemplateDialog: React.FC<UpdateTemplateDialogProps> = ({
  open,
  onOpenChange,
  lineItems,
}) => {
  const { toast } = useToast();
  const { activeTenantId } = useActiveTenantId();
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'update' | 'create'>('update');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // New template form
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateRoofType, setNewTemplateRoofType] = useState<string>('shingle');

  // Editable items
  const [items, setItems] = useState<EditableItem[]>([]);

  // Initialize editable items from line items when dialog opens
  useEffect(() => {
    if (open) {
      setItems(
        lineItems
          .filter((it) => it.item_type !== 'change_order')
          .map((it, idx) => ({
            item_name: it.item_name,
            description: it.description || '',
            item_type: it.item_type as 'material' | 'labor',
            unit: it.unit,
            unit_cost: it.unit_cost,
            quantity: (it as any).quantity,
            sort_order: it.sort_order ?? idx,
            trade_type: it.trade_type,
          }))
      );
    }
  }, [open, lineItems]);

  useEffect(() => {
    if (open && activeTenantId) {
      fetchTemplates();
    }
  }, [open, activeTenantId]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data: tpls, error } = await (supabase as any)
        .from('estimate_calculation_templates')
        .select('id, name, roof_type, template_category')
        .eq('tenant_id', activeTenantId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      const templateIds = (tpls || []).map((t: any) => t.id);
      const { data: itemsData } = await (supabase as any)
        .from('estimate_calc_template_items')
        .select('calc_template_id')
        .in('calc_template_id', templateIds)
        .eq('active', true);

      const countMap = new Map<string, number>();
      (itemsData || []).forEach((item: any) => {
        countMap.set(item.calc_template_id, (countMap.get(item.calc_template_id) || 0) + 1);
      });

      const list = (tpls || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        roof_type: t.roof_type,
        template_category: t.template_category,
        itemCount: countMap.get(t.id) || 0,
      }));
      setTemplates(list);
      // Default to create mode if none exist
      if (list.length === 0) setMode('create');
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast({ title: 'Failed to load templates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const updateItemField = (idx: number, field: 'item_name' | 'description', value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const writeItemsToTemplate = async (templateId: string) => {
    // Replace items
    const { error: deleteError } = await (supabase as any)
      .from('estimate_calc_template_items')
      .delete()
      .eq('calc_template_id', templateId)
      .eq('tenant_id', activeTenantId);
    if (deleteError) throw deleteError;

    const itemsToInsert = items.map((it, idx) => ({
      calc_template_id: templateId,
      tenant_id: activeTenantId,
      item_name: it.item_name,
      item_type: it.item_type,
      qty_formula: '1',
      unit: it.unit,
      unit_cost: it.unit_cost,
      sort_order: it.sort_order ?? idx,
      description: it.description?.trim() || null,
      active: true,
      measurement_type: null,
    }));

    if (itemsToInsert.length > 0) {
      const { error: insertError } = await (supabase as any)
        .from('estimate_calc_template_items')
        .insert(itemsToInsert);
      if (insertError) throw insertError;
    }
    return itemsToInsert.length;
  };

  const handleSave = async () => {
    if (!activeTenantId) return;

    // Validate
    const blank = items.find((it) => !it.item_name.trim());
    if (blank) {
      toast({ title: 'Item name required', description: 'All line items need a name.', variant: 'destructive' });
      return;
    }

    if (mode === 'update' && !selectedTemplateId) return;
    if (mode === 'create' && !newTemplateName.trim()) {
      toast({ title: 'Template name required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      let templateId = selectedTemplateId;
      let templateName = templates.find((t) => t.id === selectedTemplateId)?.name;

      if (mode === 'create') {
        const { data: created, error: createErr } = await (supabase as any)
          .from('estimate_calculation_templates')
          .insert({
            tenant_id: activeTenantId,
            name: newTemplateName.trim(),
            roof_type: newTemplateRoofType,
            template_category: 'standard',
            is_active: true,
          })
          .select('id, name')
          .single();
        if (createErr) throw createErr;
        templateId = created.id;
        templateName = created.name;
      }

      const count = await writeItemsToTemplate(templateId!);

      toast({
        title: mode === 'create' ? 'Template Created' : 'Template Updated',
        description: `"${templateName}" saved with ${count} line items.`,
      });

      onOpenChange(false);
      setSelectedTemplateId(null);
      setNewTemplateName('');
    } catch (err: any) {
      console.error('Error saving template:', err);
      toast({
        title: 'Save Failed',
        description: err.message || 'Could not save template',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const materialCount = useMemo(() => items.filter((i) => i.item_type === 'material').length, [items]);
  const laborCount = useMemo(() => items.filter((i) => i.item_type === 'labor').length, [items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Save Line Items to Template</DialogTitle>
          <DialogDescription>
            Edit the name and description of each line item before saving. Quantities are not carried over —
            they are set per estimate.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'update' | 'create')} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="update" disabled={templates.length === 0}>
              <Pencil className="h-4 w-4 mr-2" />
              Update Existing
            </TabsTrigger>
            <TabsTrigger value="create">
              <Plus className="h-4 w-4 mr-2" />
              Add New Template
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-2 mt-3">
            <FileText className="h-4 w-4" />
            <span>{materialCount} materials, {laborCount} labor items will be saved</span>
          </div>

          <TabsContent value="update" className="space-y-3 flex-1 overflow-hidden flex flex-col mt-3">
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>This will replace ALL existing items in the selected template.</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading templates...</span>
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No templates yet. Switch to "Add New Template" to create one.
              </div>
            ) : (
              <ScrollArea className="max-h-[220px]">
                <div className="space-y-1 pr-2">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
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
                        {selectedTemplateId === template.id && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="create" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-template-name">Template Name</Label>
                <Input
                  id="new-template-name"
                  placeholder="e.g. Standard Tile Re-roof"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-template-roof">Roof Type</Label>
                <Select value={newTemplateRoofType} onValueChange={setNewTemplateRoofType}>
                  <SelectTrigger id="new-template-roof">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROOF_TYPES.map((rt) => (
                      <SelectItem key={rt} value={rt} className="capitalize">
                        {rt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          {/* Editable item list (shared between modes) */}
          <div className="mt-3 flex-1 overflow-hidden flex flex-col min-h-[280px]">
            <div className="text-sm font-medium mb-2">Edit Line Items ({items.length})</div>
            <ScrollArea className="flex-1 border rounded-md">
              <div className="divide-y">
                {items.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">No items to save.</div>
                ) : (
                  items.map((it, idx) => (
                    <div key={idx} className="p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="secondary"
                          className={`text-xs shrink-0 ${
                            it.item_type === 'material' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {it.item_type}
                        </Badge>
                        <Input
                          value={it.item_name}
                          onChange={(e) => updateItemField(idx, 'item_name', e.target.value)}
                          placeholder="Item name (shown to customer)"
                          className="flex-1 min-w-[200px] h-8"
                        />
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                          {it.quantity != null && <span>Qty {it.quantity}</span>}
                          {it.unit && <span>· {it.unit}</span>}
                          {it.unit_cost != null && <span>· ${Number(it.unit_cost).toFixed(2)}</span>}
                        </div>
                      </div>
                      <Textarea
                        value={it.description}
                        onChange={(e) => updateItemField(idx, 'description', e.target.value)}
                        placeholder="Description (optional — shown on customer-facing PDFs)"
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || (mode === 'update' && !selectedTemplateId) || (mode === 'create' && !newTemplateName.trim())}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === 'create' ? 'Create Template' : 'Update Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
