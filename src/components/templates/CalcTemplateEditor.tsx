import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Plus, Save } from 'lucide-react';
import { useCalcTemplateEditor, CalcTemplateItem, CalcTemplateGroup } from './hooks/useCalcTemplateEditor';
import { CalcTemplateItemGroup } from './CalcTemplateItemGroup';
import { CalcItemDetailsPanel } from './CalcItemDetailsPanel';
import { CalcTemplateDetailsPanel } from './CalcTemplateDetailsPanel';
import { AddGroupDialog } from './AddGroupDialog';
import { AddItemDialog } from './AddItemDialog';
import { MaterialCheatSheet } from './MaterialCheatSheet';
import { useToast } from '@/hooks/use-toast';

const CalcTemplateEditor: React.FC = () => {
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const { toast } = useToast();
  const {
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
  } = useCalcTemplateEditor(templateId);

  const [showAddGroupDialog, setShowAddGroupDialog] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [addToGroupId, setAddToGroupId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Check if dragging groups
    const activeGroupIndex = groups.findIndex((g) => g.id === activeId);
    const overGroupIndex = groups.findIndex((g) => g.id === overId);

    if (activeGroupIndex !== -1 && overGroupIndex !== -1) {
      const newGroups = arrayMove(groups, activeGroupIndex, overGroupIndex);
      reorderGroups(newGroups);
      return;
    }

    // Check if dragging items within same group
    for (const group of groups) {
      const activeItemIndex = group.items.findIndex((i) => i.id === activeId);
      const overItemIndex = group.items.findIndex((i) => i.id === overId);

      if (activeItemIndex !== -1 && overItemIndex !== -1) {
        const newItems = arrayMove(group.items, activeItemIndex, overItemIndex);
        reorderItems(group.id, newItems);
        return;
      }
    }
  };

  const handleAddItem = (groupId: string) => {
    setAddToGroupId(groupId);
    setShowAddItemDialog(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Template not found</p>
        <Button variant="outline" onClick={() => navigate('/settings')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{template.name}</h1>
            <p className="text-sm text-muted-foreground">
              {template.roof_type} • {groups.reduce((sum, g) => sum + g.items.length, 0)} items
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowAddGroupDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Group
          </Button>
          <Button onClick={() => saveTemplate(template)} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Template
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - Groups and items */}
        <div className="w-1/2 border-r overflow-y-auto p-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={groups.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {groups.map((group) => (
                  <CalcTemplateItemGroup
                    key={group.id}
                    group={group}
                    profitMargin={template.target_profit_percentage}
                    selectedItemId={selectedItem?.id}
                    onSelectItem={(item) => setSelectedItem(item)}
                    onDeleteItem={deleteItem}
                    onDeleteGroup={deleteGroup}
                    onAddItem={() => handleAddItem(group.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {groups.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-muted-foreground mb-4">No groups yet</p>
              <Button onClick={() => setShowAddGroupDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Group
              </Button>
            </div>
          )}
        </div>

        {/* Right panel - Details */}
        <div className="w-1/2 overflow-y-auto p-4 space-y-4">
          {selectedItem ? (
            <CalcItemDetailsPanel
              item={selectedItem}
              profitMargin={template.target_profit_percentage}
              onUpdate={(updatedItem) => {
                updateItem(selectedItem.id, updatedItem);
                toast({ title: 'Item saved' });
              }}
              onDone={() => setSelectedItem(null)}
            />
          ) : (
            <>
              <CalcTemplateDetailsPanel
                template={template}
                onUpdate={saveTemplate}
                saving={saving}
              />
              <MaterialCheatSheet 
                defaultRoofType={template.roof_type === 'metal' ? 'metal-5v' : template.roof_type}
                compact 
              />
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <AddGroupDialog
        open={showAddGroupDialog}
        onOpenChange={setShowAddGroupDialog}
        onAdd={(name, groupType) => {
          addGroup(name, groupType);
          setShowAddGroupDialog(false);
        }}
      />

      <AddItemDialog
        open={showAddItemDialog}
        onOpenChange={setShowAddItemDialog}
        onAdd={(item) => {
          if (addToGroupId) {
            addItem(addToGroupId, {
              item_name: item.name,
              item_type: item.item_type,
              unit: item.unit,
              unit_cost: item.unit_cost,
            });
          }
          setShowAddItemDialog(false);
        }}
      />
    </div>
  );
};

export default CalcTemplateEditor;
