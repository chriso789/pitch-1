import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface TemplateGroup {
  id: string;
  template_id: string;
  name: string;
  group_type: 'material' | 'labor';
  sort_order: number;
  items: TemplateItem[];
}

export interface TemplateItem {
  id: string;
  template_id: string;
  group_id: string | null;
  name: string;
  estimate_item_name: string | null;
  description: string | null;
  item_type: 'material' | 'labor';
  unit: string;
  unit_cost: number;
  waste_pct: number;
  pricing_type: 'profit_margin' | 'fixed';
  fixed_price: number | null;
  measurement_type: string | null;
  quantity_formula: string | null;
  sort_order: number;
}

export interface Template {
  id: string;
  name: string;
  template_description: string | null;
  template_type: string;
  supplier_id: string | null;
  use_for: 'estimating' | 'ordering' | 'both';
  profit_margin_percent: number;
  available_trades: string[];
  labor_rate: number;
  overhead_pct: number;
  status: string;
}

export const useTemplateEditor = (templateId?: string) => {
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);
  const [groups, setGroups] = useState<TemplateGroup[]>([]);
  const [selectedItem, setSelectedItem] = useState<TemplateItem | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<TemplateGroup | null>(null);

  // Fetch template and items
  const fetchTemplate = useCallback(async () => {
    if (!templateId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch template
      const { data: templateData, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError) throw templateError;

      setTemplate({
        id: templateData.id,
        name: templateData.name,
        template_description: (templateData as any).template_description || null,
        template_type: (templateData as any).template_type || 'steep_slope',
        supplier_id: (templateData as any).supplier_id || null,
        use_for: (templateData as any).use_for || 'both',
        profit_margin_percent: (templateData as any).profit_margin_percent || 30,
        available_trades: (templateData as any).available_trades || ['Roofing'],
        labor_rate: typeof templateData.labor === 'number' ? templateData.labor : 0,
        overhead_pct: typeof templateData.overhead === 'number' ? templateData.overhead : 0,
        status: templateData.status,
      });

      // Fetch groups
      const { data: groupsData, error: groupsError } = await supabase
        .from('estimate_template_groups')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order');

      if (groupsError) throw groupsError;

      // Fetch items
      const { data: itemsData, error: itemsError } = await supabase
        .from('template_items')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order');

      if (itemsError) throw itemsError;

      // Organize items into groups
      const groupsWithItems: TemplateGroup[] = (groupsData || []).map((group: any) => ({
        id: group.id,
        template_id: group.template_id,
        name: group.name,
        group_type: group.group_type || 'material',
        sort_order: group.sort_order,
        items: (itemsData || [])
          .filter((item: any) => item.group_id === group.id)
          .map((item: any) => ({
            id: item.id,
            template_id: item.template_id,
            group_id: item.group_id,
            name: item.item_name || 'Unnamed Item',
            estimate_item_name: item.estimate_item_name,
            description: item.description,
            item_type: item.item_type || 'material',
            unit: item.unit,
            unit_cost: item.unit_cost,
            waste_pct: item.waste_pct,
            pricing_type: item.pricing_type || 'profit_margin',
            fixed_price: item.fixed_price,
            measurement_type: item.measurement_type,
            quantity_formula: item.qty_formula,
            sort_order: item.sort_order,
          })),
      }));

      // Add ungrouped items as a default group
      const ungroupedItems = (itemsData || [])
        .filter((item: any) => !item.group_id)
        .map((item: any) => ({
          id: item.id,
          template_id: item.template_id,
          group_id: null,
          name: item.item_name || 'Unnamed Item',
          estimate_item_name: item.estimate_item_name,
          description: item.description,
          item_type: item.item_type || 'material',
          unit: item.unit,
          unit_cost: item.unit_cost,
          waste_pct: item.waste_pct,
          pricing_type: item.pricing_type || 'profit_margin',
          fixed_price: item.fixed_price,
          measurement_type: item.measurement_type,
          quantity_formula: item.qty_formula,
          sort_order: item.sort_order,
        }));

      if (ungroupedItems.length > 0) {
        groupsWithItems.unshift({
          id: 'ungrouped',
          template_id: templateId,
          name: 'Ungrouped Items',
          group_type: 'material',
          sort_order: -1,
          items: ungroupedItems,
        });
      }

      setGroups(groupsWithItems);
    } catch (error: any) {
      console.error('Error fetching template:', error);
      toast({
        title: 'Error',
        description: 'Failed to load template',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [templateId, toast]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  // Save template
  const saveTemplate = async (updates: Partial<Template>) => {
    if (!template) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('templates')
        .update({
          name: updates.name ?? template.name,
          template_description: updates.template_description,
          template_type: updates.template_type,
          supplier_id: updates.supplier_id,
          use_for: updates.use_for,
          profit_margin_percent: updates.profit_margin_percent,
          available_trades: updates.available_trades,
        } as any)
        .eq('id', template.id);

      if (error) throw error;

      setTemplate({ ...template, ...updates });
      toast({ title: 'Template saved' });
    } catch (error: any) {
      console.error('Error saving template:', error);
      toast({
        title: 'Error',
        description: 'Failed to save template',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Add group
  const addGroup = async (name: string, groupType: 'material' | 'labor') => {
    if (!template) return;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const newOrder = Math.max(...groups.map((g) => g.sort_order), 0) + 1;

      const { data, error } = await supabase
        .from('estimate_template_groups')
        .insert({
          template_id: template.id,
          name,
          group_type: groupType,
          sort_order: newOrder,
          tenant_id: profile.tenant_id,
        })
        .select()
        .single();

      if (error) throw error;

      setGroups([
        ...groups,
        {
          id: data.id,
          template_id: data.template_id,
          name: data.name,
          group_type: data.group_type as 'material' | 'labor',
          sort_order: data.sort_order,
          items: [],
        },
      ]);

      toast({ title: 'Group added' });
    } catch (error: any) {
      console.error('Error adding group:', error);
      toast({
        title: 'Error',
        description: 'Failed to add group',
        variant: 'destructive',
      });
    }
  };

  // Delete group
  const deleteGroup = async (groupId: string) => {
    try {
      const { error } = await supabase
        .from('estimate_template_groups')
        .delete()
        .eq('id', groupId);

      if (error) throw error;

      setGroups(groups.filter((g) => g.id !== groupId));
      toast({ title: 'Group deleted' });
    } catch (error: any) {
      console.error('Error deleting group:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete group',
        variant: 'destructive',
      });
    }
  };

  // Add item
  const addItem = async (groupId: string | null, item: Partial<TemplateItem> & { saveToCatalog?: boolean; sku?: string; coverage_per_unit?: number }) => {
    if (!template) return;

    try {
      const group = groups.find((g) => g.id === groupId);
      const newOrder = group
        ? Math.max(...group.items.map((i) => i.sort_order), 0) + 1
        : 0;

      const { data, error } = await supabase
        .from('template_items')
        .insert({
          template_id: template.id,
          group_id: groupId === 'ungrouped' ? null : groupId,
          name: item.name || 'New Item',
          estimate_item_name: item.estimate_item_name,
          description: item.description,
          item_type: item.item_type || 'material',
          unit: item.unit || 'EA',
          unit_cost: item.unit_cost || 0,
          waste_pct: item.waste_pct || 0,
          pricing_type: item.pricing_type || 'profit_margin',
          fixed_price: item.fixed_price,
          measurement_type: item.measurement_type,
          sort_order: newOrder,
        } as any)
        .select()
        .single();

      if (error) throw error;

      // If saveToCatalog flag is true, also save to materials catalog
      if (item.saveToCatalog && item.item_type === 'material' && effectiveTenantId) {
        const materialCode = item.sku || `CUSTOM-${Date.now()}`;
        
        await supabase.rpc('api_upsert_material' as any, {
          p_code: materialCode,
          p_name: item.name,
          p_tenant_id: effectiveTenantId,
          p_uom: item.unit || 'EA',
          p_base_cost: item.unit_cost || 0,
          p_coverage_per_unit: item.coverage_per_unit || null,
        });
      }

      const newItem: TemplateItem = {
        id: data.id,
        template_id: data.template_id,
        group_id: data.group_id,
        name: data.item_name || 'New Item',
        estimate_item_name: data.estimate_item_name,
        description: data.description,
        item_type: (data.item_type as 'material' | 'labor') || 'material',
        unit: data.unit,
        unit_cost: data.unit_cost,
        waste_pct: data.waste_pct,
        pricing_type: (data.pricing_type as 'profit_margin' | 'fixed') || 'profit_margin',
        fixed_price: data.fixed_price,
        measurement_type: data.measurement_type,
        quantity_formula: data.qty_formula || null,
        sort_order: data.sort_order,
      };

      setGroups(
        groups.map((g) =>
          g.id === groupId ? { ...g, items: [...g.items, newItem] } : g
        )
      );

      const message = item.saveToCatalog 
        ? 'Item added and saved to catalog' 
        : 'Item added';
      toast({ title: message });
      return newItem;
    } catch (error: any) {
      console.error('Error adding item:', error);
      toast({
        title: 'Error',
        description: 'Failed to add item',
        variant: 'destructive',
      });
    }
  };

  // Update item
  const updateItem = async (itemId: string, updates: Partial<TemplateItem>) => {
    try {
      const { error } = await supabase
        .from('template_items')
        .update({
          name: updates.name,
          estimate_item_name: updates.estimate_item_name,
          description: updates.description,
          item_type: updates.item_type,
          unit: updates.unit,
          unit_cost: updates.unit_cost,
          waste_pct: updates.waste_pct,
          pricing_type: updates.pricing_type,
          fixed_price: updates.fixed_price,
          measurement_type: updates.measurement_type,
        } as any)
        .eq('id', itemId);

      if (error) throw error;

      setGroups(
        groups.map((g) => ({
          ...g,
          items: g.items.map((i) =>
            i.id === itemId ? { ...i, ...updates } : i
          ),
        }))
      );

      if (selectedItem?.id === itemId) {
        setSelectedItem({ ...selectedItem, ...updates });
      }

      toast({ title: 'Item updated' });
    } catch (error: any) {
      console.error('Error updating item:', error);
      toast({
        title: 'Error',
        description: 'Failed to update item',
        variant: 'destructive',
      });
    }
  };

  // Delete item
  const deleteItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('template_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      setGroups(
        groups.map((g) => ({
          ...g,
          items: g.items.filter((i) => i.id !== itemId),
        }))
      );

      if (selectedItem?.id === itemId) {
        setSelectedItem(null);
      }

      toast({ title: 'Item deleted' });
    } catch (error: any) {
      console.error('Error deleting item:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete item',
        variant: 'destructive',
      });
    }
  };

  // Reorder groups
  const reorderGroups = async (newGroups: TemplateGroup[]) => {
    setGroups(newGroups);

    try {
      for (let i = 0; i < newGroups.length; i++) {
        if (newGroups[i].id !== 'ungrouped') {
          await supabase
            .from('estimate_template_groups')
            .update({ sort_order: i })
            .eq('id', newGroups[i].id);
        }
      }
    } catch (error) {
      console.error('Error reordering groups:', error);
    }
  };

  // Reorder items within a group
  const reorderItems = async (groupId: string, newItems: TemplateItem[]) => {
    setGroups(
      groups.map((g) => (g.id === groupId ? { ...g, items: newItems } : g))
    );

    try {
      for (let i = 0; i < newItems.length; i++) {
        await supabase
          .from('template_items')
          .update({ sort_order: i })
          .eq('id', newItems[i].id);
      }
    } catch (error) {
      console.error('Error reordering items:', error);
    }
  };

  return {
    loading,
    saving,
    template,
    groups,
    selectedItem,
    selectedGroup,
    setSelectedItem,
    setSelectedGroup,
    saveTemplate,
    addGroup,
    deleteGroup,
    addItem,
    updateItem,
    deleteItem,
    reorderGroups,
    reorderItems,
    refetch: fetchTemplate,
  };
};
