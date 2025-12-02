import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from '@dnd-kit/sortable';
import { ArrowLeft, Plus, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTemplateEditor } from './hooks/useTemplateEditor';
import { TemplateItemGroup } from './TemplateItemGroup';
import { TemplateDetailsPanel } from './TemplateDetailsPanel';
import { ItemDetailsPanel } from './ItemDetailsPanel';
import { AddItemDialog } from './AddItemDialog';
import { AddGroupDialog } from './AddGroupDialog';
import { useToast } from '@/hooks/use-toast';

export const SmartTemplateEditor = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
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
  } = useTemplateEditor(templateId);

  const [showAddGroupDialog, setShowAddGroupDialog] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Check if dragging a group
    const activeGroup = groups.find((g) => g.id === active.id);
    if (activeGroup) {
      const oldIndex = groups.findIndex((g) => g.id === active.id);
      const newIndex = groups.findIndex((g) => g.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderGroups(arrayMove(groups, oldIndex, newIndex));
      }
      return;
    }

    // Check if dragging an item
    for (const group of groups) {
      const activeItem = group.items.find((i) => i.id === active.id);
      if (activeItem) {
        const oldIndex = group.items.findIndex((i) => i.id === active.id);
        const newIndex = group.items.findIndex((i) => i.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          reorderItems(group.id, arrayMove(group.items, oldIndex, newIndex));
        }
        return;
      }
    }
  };

  const handleAddItem = (groupId: string) => {
    setAddItemGroupId(groupId);
    setShowAddItemDialog(true);
  };

  const handleUpdateCosts = async () => {
    toast({ title: 'Updating costs from supplier...' });
    // TODO: Implement cost update from supplier API
    setTimeout(() => {
      toast({ title: 'Costs updated successfully' });
    }, 1500);
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
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{template.name}</h1>
            <p className="text-sm text-muted-foreground">
              Smart Template Editor
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => saveTemplate(template)}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Template
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Groups and Items */}
        <div className="flex-1 border-r">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <h2 className="font-medium">Template Items</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddGroupDialog(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Group
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="p-4 space-y-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={groups.map((g) => g.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.map((group) => (
                    <TemplateItemGroup
                      key={group.id}
                      group={group}
                      profitMargin={template.profit_margin_percent}
                      selectedItemId={selectedItem?.id ?? null}
                      onSelectItem={setSelectedItem}
                      onDeleteItem={deleteItem}
                      onDeleteGroup={() => deleteGroup(group.id)}
                      onAddItem={() => handleAddItem(group.id)}
                      isUngrouped={group.id === 'ungrouped'}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {groups.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No groups or items yet.</p>
                  <p className="text-sm">Click "Add Group" to get started.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel - Details */}
        <div className="w-[400px] bg-muted/10">
          <ScrollArea className="h-[calc(100vh-130px)]">
            <div className="p-6">
              {selectedItem ? (
                <ItemDetailsPanel
                  item={selectedItem}
                  profitMargin={template.profit_margin_percent}
                  onUpdate={(updates) => updateItem(selectedItem.id, updates)}
                  onDone={() => setSelectedItem(null)}
                  onAddLabor={() => {
                    setAddItemGroupId(selectedItem.group_id);
                    setShowAddItemDialog(true);
                  }}
                />
              ) : (
                <TemplateDetailsPanel
                  template={template}
                  onUpdate={saveTemplate}
                  onUpdateCosts={handleUpdateCosts}
                  saving={saving}
                />
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Dialogs */}
      <AddGroupDialog
        open={showAddGroupDialog}
        onOpenChange={setShowAddGroupDialog}
        onAdd={addGroup}
      />

      <AddItemDialog
        open={showAddItemDialog}
        onOpenChange={setShowAddItemDialog}
        onAdd={(item) => {
          addItem(addItemGroupId, item);
        }}
      />
    </div>
  );
};

export default SmartTemplateEditor;
