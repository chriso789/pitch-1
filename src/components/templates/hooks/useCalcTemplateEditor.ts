import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface CalcTemplateGroup {
  id: string;
  calc_template_id: string;
  name: string;
  group_type: 'material' | 'labor';
  sort_order: number;
  items: CalcTemplateItem[];
}

export interface CalcTemplateItem {
  id: string;
  calc_template_id: string;
  group_id: string | null;
  item_name: string;
  description: string | null;
  item_type: 'material' | 'labor';
  unit: string;
  unit_cost: number;
  qty_formula: string;
  measurement_type: string | null;
  coverage_per_unit: number | null;
  sku_pattern: string | null;
  manufacturer: string | null;
  sort_order: number;
  active: boolean;
  margin_override: number;
}

export interface CalcTemplate {
  id: string;
  name: string;
  roof_type: string;
  template_category: string;
  is_active: boolean;
  overhead_percentage: number;
  target_profit_percentage: number;
}

export const useCalcTemplateEditor = (templateId?: string) => {
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<CalcTemplate | null>(null);
  const [groups, setGroups] = useState<CalcTemplateGroup[]>([]);
  const [selectedItem, setSelectedItem] = useState<CalcTemplateItem | null>(null);

  // Fetch template and items from the correct tables
  const fetchTemplate = useCallback(async () => {
    if (!templateId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch template from estimate_calculation_templates
      const { data: templateData, error: templateError } = await supabase
        .from('estimate_calculation_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError) throw templateError;

      setTemplate({
        id: templateData.id,
        name: templateData.name,
        roof_type: templateData.roof_type,
        template_category: templateData.template_category,
        is_active: templateData.is_active,
        overhead_percentage: templateData.overhead_percentage,
        target_profit_percentage: templateData.target_profit_percentage,
      });

      // Fetch groups from estimate_calc_template_groups
      const { data: groupsData, error: groupsError } = await supabase
        .from('estimate_calc_template_groups')
        .select('*')
        .eq('calc_template_id', templateId)
        .order('sort_order');

      if (groupsError) throw groupsError;

      // Fetch items from estimate_calc_template_items
      const { data: itemsData, error: itemsError } = await supabase
        .from('estimate_calc_template_items')
        .select('*')
        .eq('calc_template_id', templateId)
        .order('sort_order');

      if (itemsError) throw itemsError;

      // Organize items into groups
      const groupsWithItems: CalcTemplateGroup[] = (groupsData || []).map((group: any) => ({
        id: group.id,
        calc_template_id: group.calc_template_id,
        name: group.name,
        group_type: group.group_type || 'material',
        sort_order: group.sort_order,
        items: (itemsData || [])
          .filter((item: any) => item.group_id === group.id)
          .map((item: any) => ({
            id: item.id,
            calc_template_id: item.calc_template_id,
            group_id: item.group_id,
            item_name: item.item_name || 'Unnamed Item',
            description: item.description,
            item_type: item.item_type || 'material',
            unit: item.unit,
            unit_cost: Number(item.unit_cost) || 0,
            qty_formula: item.qty_formula || '1',
            measurement_type: item.measurement_type,
            coverage_per_unit: item.coverage_per_unit ? Number(item.coverage_per_unit) : null,
            sku_pattern: item.sku_pattern,
            manufacturer: item.manufacturer,
            sort_order: item.sort_order,
            active: item.active,
            margin_override: Number(item.margin_override) || 0,
          })),
      }));

      // Add ungrouped items as a default group
      const ungroupedItems = (itemsData || [])
        .filter((item: any) => !item.group_id)
        .map((item: any) => ({
          id: item.id,
          calc_template_id: item.calc_template_id,
          group_id: null,
          item_name: item.item_name || 'Unnamed Item',
          description: item.description,
          item_type: item.item_type || 'material',
          unit: item.unit,
          unit_cost: Number(item.unit_cost) || 0,
          qty_formula: item.qty_formula || '1',
          measurement_type: item.measurement_type,
          coverage_per_unit: item.coverage_per_unit ? Number(item.coverage_per_unit) : null,
          sku_pattern: item.sku_pattern,
          manufacturer: item.manufacturer,
          sort_order: item.sort_order,
          active: item.active,
          margin_override: Number(item.margin_override) || 0,
        }));

      if (ungroupedItems.length > 0) {
        groupsWithItems.unshift({
          id: 'ungrouped',
          calc_template_id: templateId,
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
  const saveTemplate = async (updates: Partial<CalcTemplate>) => {
    if (!template) return;

    try {
      setSaving(true);

      const updatePayload: Record<string, any> = {};
      if (updates.name !== undefined) updatePayload.name = updates.name;
      if (updates.roof_type !== undefined) updatePayload.roof_type = updates.roof_type as any;
      if (updates.template_category !== undefined) updatePayload.template_category = updates.template_category;
      if (updates.is_active !== undefined) updatePayload.is_active = updates.is_active;
      if (updates.overhead_percentage !== undefined) updatePayload.overhead_percentage = updates.overhead_percentage;
      if (updates.target_profit_percentage !== undefined) updatePayload.target_profit_percentage = updates.target_profit_percentage;

      const { error } = await supabase
        .from('estimate_calculation_templates')
        .update(updatePayload)
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
    if (!template || !effectiveTenantId) return;

    try {
      const newOrder = Math.max(...groups.map((g) => g.sort_order), 0) + 1;

      const { data, error } = await supabase
        .from('estimate_calc_template_groups')
        .insert({
          calc_template_id: template.id,
          name,
          group_type: groupType,
          sort_order: newOrder,
          tenant_id: effectiveTenantId,
        })
        .select()
        .single();

      if (error) throw error;

      setGroups([
        ...groups,
        {
          id: data.id,
          calc_template_id: data.calc_template_id,
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
    if (groupId === 'ungrouped') {
      toast({
        title: 'Cannot delete',
        description: 'Ungrouped items cannot be deleted as a group',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('estimate_calc_template_groups')
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
  const addItem = async (groupId: string | null, item: Partial<CalcTemplateItem>) => {
    if (!template || !effectiveTenantId) return;

    try {
      const group = groups.find((g) => g.id === groupId);
      const newOrder = group
        ? Math.max(...group.items.map((i) => i.sort_order), 0) + 1
        : 0;

      const { data, error } = await supabase
        .from('estimate_calc_template_items')
        .insert({
          calc_template_id: template.id,
          group_id: groupId === 'ungrouped' ? null : groupId,
          item_name: item.item_name || 'New Item',
          description: item.description,
          item_type: item.item_type || 'material',
          unit: item.unit || 'EA',
          unit_cost: item.unit_cost || 0,
          qty_formula: item.qty_formula || '1',
          measurement_type: item.measurement_type,
          coverage_per_unit: item.coverage_per_unit,
          sort_order: newOrder,
          tenant_id: effectiveTenantId,
          active: true,
        })
        .select()
        .single();

      if (error) throw error;

      const newItem: CalcTemplateItem = {
        id: data.id,
        calc_template_id: data.calc_template_id,
        group_id: data.group_id,
        item_name: data.item_name || 'New Item',
        description: data.description,
        item_type: (data.item_type as 'material' | 'labor') || 'material',
        unit: data.unit,
        unit_cost: Number(data.unit_cost) || 0,
        qty_formula: data.qty_formula || '1',
        measurement_type: data.measurement_type,
        coverage_per_unit: data.coverage_per_unit ? Number(data.coverage_per_unit) : null,
        sku_pattern: data.sku_pattern,
        manufacturer: data.manufacturer,
        sort_order: data.sort_order,
        active: data.active,
        margin_override: Number(data.margin_override) || 0,
      };

      setGroups(
        groups.map((g) =>
          g.id === groupId ? { ...g, items: [...g.items, newItem] } : g
        )
      );

      toast({ title: 'Item added' });
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
  const updateItem = async (itemId: string, updates: Partial<CalcTemplateItem>) => {
    try {
      const { error } = await supabase
        .from('estimate_calc_template_items')
        .update({
          item_name: updates.item_name,
          description: updates.description,
          item_type: updates.item_type,
          unit: updates.unit,
          unit_cost: updates.unit_cost,
          qty_formula: updates.qty_formula,
          measurement_type: updates.measurement_type,
          coverage_per_unit: updates.coverage_per_unit,
          sku_pattern: updates.sku_pattern,
          manufacturer: updates.manufacturer,
          active: updates.active,
          margin_override: updates.margin_override,
        })
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
      // Toast removed - shown by caller on Done
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
        .from('estimate_calc_template_items')
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
  const reorderGroups = async (newGroups: CalcTemplateGroup[]) => {
    setGroups(newGroups);

    try {
      for (let i = 0; i < newGroups.length; i++) {
        if (newGroups[i].id !== 'ungrouped') {
          await supabase
            .from('estimate_calc_template_groups')
            .update({ sort_order: i })
            .eq('id', newGroups[i].id);
        }
      }
    } catch (error) {
      console.error('Error reordering groups:', error);
    }
  };

  // Reorder items within a group
  const reorderItems = async (groupId: string, newItems: CalcTemplateItem[]) => {
    setGroups(
      groups.map((g) => (g.id === groupId ? { ...g, items: newItems } : g))
    );

    try {
      for (let i = 0; i < newItems.length; i++) {
        await supabase
          .from('estimate_calc_template_items')
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
    setSelectedItem,
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
