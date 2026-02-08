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
  material_id: string | null;
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
            material_id: item.material_id || null,
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
          material_id: item.material_id || null,
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

  // Save template - returns success boolean for navigation
  const saveTemplate = async (updates: Partial<CalcTemplate>): Promise<boolean> => {
    if (!template) return false;

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
      return true;
    } catch (error: any) {
      console.error('Error saving template:', error);
      toast({
        title: 'Error',
        description: 'Failed to save template',
        variant: 'destructive',
      });
      return false;
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
  const addItem = async (groupId: string | null, item: Partial<CalcTemplateItem> & { saveToCatalog?: boolean }) => {
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

      // If saveToCatalog flag is true, also save to materials catalog
      let catalogSaveSuccess = true;
      let savedMaterialId: string | null = null;
      if (item.saveToCatalog && item.item_type === 'material') {
        const materialCode = item.sku_pattern || `CUSTOM-${Date.now()}`;
        
        const { data: materialId, error: materialError } = await supabase.rpc('api_upsert_material' as any, {
          p_code: materialCode,
          p_name: item.item_name,
          p_tenant_id: effectiveTenantId,
          p_uom: item.unit || 'EA',
          p_base_cost: item.unit_cost || 0,
          p_coverage_per_unit: item.coverage_per_unit || null,
        });

        if (materialError) {
          console.error('Failed to save to catalog:', materialError);
          catalogSaveSuccess = false;
        } else if (materialId) {
          savedMaterialId = materialId;
          // Link the template item to the catalog material
          await supabase
            .from('estimate_calc_template_items')
            .update({ material_id: materialId })
            .eq('id', data.id);
        }
      }

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
        material_id: savedMaterialId || data.material_id || null,
      };

      setGroups(
        groups.map((g) =>
          g.id === groupId ? { ...g, items: [...g.items, newItem] } : g
        )
      );

      const message = item.saveToCatalog 
        ? (catalogSaveSuccess ? 'Item added and saved to catalog' : 'Item added, but catalog save failed')
        : 'Item added';
      toast({ 
        title: message,
        variant: item.saveToCatalog && !catalogSaveSuccess ? 'destructive' : 'default',
      });
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

  // Save existing item to materials catalog
  const saveItemToCatalog = async (item: CalcTemplateItem): Promise<boolean> => {
    if (!effectiveTenantId || item.item_type !== 'material') {
      toast({
        title: 'Cannot save to catalog',
        description: 'Only material items can be saved to the catalog',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const materialCode = item.sku_pattern || `CUSTOM-${Date.now()}`;
      
      const { data: materialId, error: materialError } = await supabase.rpc('api_upsert_material' as any, {
        p_code: materialCode,
        p_name: item.item_name,
        p_tenant_id: effectiveTenantId,
        p_uom: item.unit || 'EA',
        p_base_cost: item.unit_cost || 0,
        p_coverage_per_unit: item.coverage_per_unit || null,
      });

      if (materialError) {
        console.error('Failed to save to catalog:', materialError);
        toast({
          title: 'Failed to save to catalog',
          description: materialError.message,
          variant: 'destructive',
        });
        return false;
      }

      // Link the template item to the catalog material
      if (materialId) {
        await supabase
          .from('estimate_calc_template_items')
          .update({ material_id: materialId })
          .eq('id', item.id);

        // Update local state to remove "Not in catalog" badge
        setGroups(groups.map(g => ({
          ...g,
          items: g.items.map(i => 
            i.id === item.id ? { ...i, material_id: materialId } : i
          )
        })));
      }

      toast({ title: 'Material saved to company catalog' });
      return true;
    } catch (error: any) {
      console.error('Error saving to catalog:', error);
      toast({
        title: 'Error',
        description: 'Failed to save material to catalog',
        variant: 'destructive',
      });
      return false;
    }
  };

  // Bulk catalog all uncataloged material items
  const catalogAllItems = async (): Promise<number> => {
    if (!template || !effectiveTenantId) {
      toast({
        title: 'Cannot catalog items',
        description: 'Template or tenant information is missing',
        variant: 'destructive',
      });
      return 0;
    }

    try {
      const { data, error } = await supabase.rpc('api_bulk_sync_template_items_to_catalog', {
        p_template_id: template.id,
        p_tenant_id: effectiveTenantId,
      });

      if (error) {
        console.error('Failed to bulk catalog items:', error);
        toast({
          title: 'Failed to catalog items',
          description: error.message,
          variant: 'destructive',
        });
        return 0;
      }

      const count = data as number;
      
      if (count > 0) {
        // Refresh the template to get updated material_id links
        await fetchTemplate();
        toast({ 
          title: `${count} item${count > 1 ? 's' : ''} added to company catalog`,
          description: 'All "Not in catalog" badges have been removed',
        });
      } else {
        toast({ 
          title: 'All items already cataloged',
          description: 'No uncataloged material items found',
        });
      }

      return count;
    } catch (error: any) {
      console.error('Error bulk cataloging items:', error);
      toast({
        title: 'Error',
        description: 'Failed to catalog items',
        variant: 'destructive',
      });
      return 0;
    }
  };

  // Count uncataloged material items
  const uncatalogedCount = groups.reduce((count, group) => {
    return count + group.items.filter(item => 
      item.item_type === 'material' && !item.material_id
    ).length;
  }, 0);

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
    saveItemToCatalog,
    catalogAllItems,
    uncatalogedCount,
    refetch: fetchTemplate,
  };
};
