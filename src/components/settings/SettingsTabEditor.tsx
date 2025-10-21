import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { IconSelector } from './IconSelector';
import { GripVertical, Save, X } from 'lucide-react';
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
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SettingsTab {
  id: string;
  tab_key: string;
  label: string;
  description: string | null;
  icon_name: string;
  order_index: number;
  is_active: boolean;
  required_role: string[] | null;
}

interface SortableTabItemProps {
  tab: SettingsTab;
  onEdit: (tab: SettingsTab) => void;
}

const SortableTabItem = ({ tab, onEdit }: SortableTabItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-4 bg-card border rounded-lg"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-move text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{tab.label}</div>
        {tab.description && (
          <div className="text-sm text-muted-foreground truncate">{tab.description}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1">
          Key: {tab.tab_key} | Icon: {tab.icon_name}
          {tab.required_role && ` | Roles: ${tab.required_role.join(', ')}`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={tab.is_active} disabled />
        <Button variant="outline" size="sm" onClick={() => onEdit(tab)}>
          Edit
        </Button>
      </div>
    </div>
  );
};

interface SettingsTabEditorProps {
  onSave?: () => void;
}

export const SettingsTabEditor = ({ onSave }: SettingsTabEditorProps) => {
  const [tabs, setTabs] = useState<SettingsTab[]>([]);
  const [editingTab, setEditingTab] = useState<SettingsTab | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadTabs();
  }, []);

  const loadTabs = async () => {
    try {
      const { data, error } = await supabase
        .from('settings_tabs')
        .select('*')
        .order('order_index', { ascending: true });

      if (error) throw error;
      setTabs(data || []);
    } catch (error) {
      console.error('Error loading tabs:', error);
      toast({
        title: 'Error loading tabs',
        description: 'Failed to load tab configuration',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const oldIndex = tabs.findIndex(t => t.id === active.id);
    const newIndex = tabs.findIndex(t => t.id === over.id);
    
    const reordered = arrayMove(tabs, oldIndex, newIndex);
    
    // Update order_index for all tabs
    const updates = reordered.map((tab, index) => ({
      ...tab,
      order_index: index + 1,
    }));

    setTabs(updates);

    // Save to database
    try {
      // Update each tab's order individually
      const updatePromises = updates.map(t =>
        supabase
          .from('settings_tabs')
          .update({ order_index: t.order_index })
          .eq('id', t.id)
      );
      
      const results = await Promise.all(updatePromises);
      const error = results.find(r => r.error)?.error;
      
      if (error) throw error;

      toast({
        title: 'Order updated',
        description: 'Tab order has been saved',
      });
      onSave?.();
    } catch (error) {
      console.error('Error saving order:', error);
      toast({
        title: 'Error',
        description: 'Failed to save tab order',
        variant: 'destructive',
      });
      loadTabs(); // Reload to revert
    }
  };

  const saveTab = async () => {
    if (!editingTab) return;

    try {
      const { error } = await supabase
        .from('settings_tabs')
        .update({
          label: editingTab.label,
          description: editingTab.description,
          icon_name: editingTab.icon_name,
          is_active: editingTab.is_active,
        })
        .eq('id', editingTab.id);

      if (error) throw error;

      toast({
        title: 'Tab updated',
        description: `${editingTab.label} has been saved`,
      });

      setEditingTab(null);
      loadTabs();
      onSave?.();
    } catch (error) {
      console.error('Error saving tab:', error);
      toast({
        title: 'Error',
        description: 'Failed to save tab',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Loading tab configuration...</div>;
  }

  if (editingTab) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Edit Tab: {editingTab.tab_key}</h3>
            <Button variant="ghost" size="sm" onClick={() => setEditingTab(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Label</Label>
              <Input
                value={editingTab.label}
                onChange={(e) => setEditingTab({ ...editingTab, label: e.target.value })}
                placeholder="Tab label"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={editingTab.description || ''}
                onChange={(e) => setEditingTab({ ...editingTab, description: e.target.value })}
                placeholder="Description shown in tooltip"
                rows={3}
              />
            </div>

            <div>
              <Label>Icon</Label>
              <IconSelector
                value={editingTab.icon_name}
                onChange={(iconName) => setEditingTab({ ...editingTab, icon_name: iconName })}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={editingTab.is_active}
                onCheckedChange={(checked) => setEditingTab({ ...editingTab, is_active: checked })}
              />
              <Label>Show this tab</Label>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={saveTab}>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
              <Button variant="outline" onClick={() => setEditingTab(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Settings Tab Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Drag to reorder, click Edit to customize labels and descriptions
          </p>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map(t => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {tabs.map(tab => (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                onEdit={setEditingTab}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};
