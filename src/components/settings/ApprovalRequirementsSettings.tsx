import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getIcon, availableIcons } from '@/lib/iconMap';
import { 
  GripVertical, 
  Pencil, 
  Save, 
  X, 
  Plus,
  Trash2,
  Settings2,
  CheckCircle,
  AlertCircle,
  Upload,
  FileText,
  Camera,
  ClipboardCheck,
  DollarSign
} from 'lucide-react';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ApprovalRequirement {
  id: string;
  tenant_id: string;
  requirement_key: string;
  label: string;
  icon_name: string;
  is_active: boolean;
  is_required: boolean;
  sort_order: number;
  validation_type: string;
  description?: string | null;
}

// Action types that map to validation_type
const ACTION_TYPES = [
  { value: 'document', label: 'Upload Document', icon: FileText, description: 'Requires a document to be uploaded' },
  { value: 'estimate', label: 'Select Estimate', icon: DollarSign, description: 'Requires an estimate to be selected' },
  { value: 'photos', label: 'Upload Photos', icon: Camera, description: 'Requires inspection photos' },
  { value: 'manual', label: 'Manual Verification', icon: ClipboardCheck, description: 'Admin manually marks complete' },
  { value: 'custom', label: 'Custom Check', icon: Settings2, description: 'Custom validation logic' },
];

const getActionLabel = (type: string) => {
  return ACTION_TYPES.find(a => a.value === type)?.label || type;
};

interface SortableItemProps {
  requirement: ApprovalRequirement;
  onEdit: (req: ApprovalRequirement) => void;
  onToggleActive: (id: string, active: boolean) => void;
  onToggleRequired: (id: string, required: boolean) => void;
  onDelete: (id: string) => void;
}

function SortableItem({ requirement, onEdit, onToggleActive, onToggleRequired, onDelete }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: requirement.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = getIcon(requirement.icon_name);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border bg-card transition-all",
        isDragging && "opacity-50 shadow-lg",
        !requirement.is_active && "opacity-60"
      )}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-5 w-5" />
      </div>

      {/* Icon */}
      <div className={cn(
        "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
        requirement.is_active ? "bg-primary/10" : "bg-muted"
      )}>
        <Icon className={cn(
          "h-5 w-5",
          requirement.is_active ? "text-primary" : "text-muted-foreground"
        )} />
      </div>

      {/* Label & Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{requirement.label}</span>
          {requirement.is_required && (
            <Badge variant="secondary" className="text-xs">Required</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          Action: {getActionLabel(requirement.validation_type)}
          {requirement.description && ` • ${requirement.description}`}
        </p>
      </div>

      {/* Toggles */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor={`active-${requirement.id}`} className="text-xs text-muted-foreground">
            Active
          </Label>
          <Switch
            id={`active-${requirement.id}`}
            checked={requirement.is_active}
            onCheckedChange={(checked) => onToggleActive(requirement.id, checked)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`required-${requirement.id}`} className="text-xs text-muted-foreground">
            Required
          </Label>
          <Switch
            id={`required-${requirement.id}`}
            checked={requirement.is_required}
            onCheckedChange={(checked) => onToggleRequired(requirement.id, checked)}
            disabled={!requirement.is_active}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(requirement)}
          className="h-8 w-8"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(requirement.id)}
          className="h-8 w-8 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ApprovalRequirementsSettings() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Edit state
  const [editingRequirement, setEditingRequirement] = useState<ApprovalRequirement | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editValidationType, setEditValidationType] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false);
  
  // Create state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('FileText');
  const [newValidationType, setNewValidationType] = useState('document');
  const [newDescription, setNewDescription] = useState('');
  const [newIsRequired, setNewIsRequired] = useState(false);
  const [newIconPopoverOpen, setNewIconPopoverOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const tenantId = user?.active_tenant_id ?? user?.tenant_id;

  // Fetch requirements
  const { data: requirements = [], isLoading } = useQuery({
    queryKey: ['tenant-approval-requirements', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('tenant_approval_requirements')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as ApprovalRequirement[];
    },
    enabled: !!tenantId,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<ApprovalRequirement> & { id: string }) => {
      const { id, ...data } = updates;
      const { error } = await supabase
        .from('tenant_approval_requirements')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-approval-requirements', tenantId] });
      toast({ title: 'Requirement updated' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (newReq: {
      label: string;
      icon_name: string;
      validation_type: string;
      description: string;
      is_required: boolean;
    }) => {
      const key = newReq.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const { error } = await supabase
        .from('tenant_approval_requirements')
        .insert({
          tenant_id: tenantId,
          requirement_key: key,
          label: newReq.label,
          icon_name: newReq.icon_name,
          validation_type: newReq.validation_type,
          description: newReq.description || null,
          is_active: true,
          is_required: newReq.is_required,
          sort_order: requirements.length + 1,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-approval-requirements', tenantId] });
      toast({ title: 'Requirement created' });
      setCreateDialogOpen(false);
      resetCreateForm();
    },
    onError: (error) => {
      toast({ title: 'Failed to create', description: error.message, variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tenant_approval_requirements')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-approval-requirements', tenantId] });
      toast({ title: 'Requirement deleted' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete', description: error.message, variant: 'destructive' });
    },
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: { id: string; sort_order: number }[]) => {
      const updates = orderedIds.map(({ id, sort_order }) =>
        supabase.from('tenant_approval_requirements').update({ sort_order }).eq('id', id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-approval-requirements', tenantId] });
    },
  });

  const resetCreateForm = () => {
    setNewLabel('');
    setNewIcon('FileText');
    setNewValidationType('document');
    setNewDescription('');
    setNewIsRequired(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = requirements.findIndex((r) => r.id === active.id);
    const newIndex = requirements.findIndex((r) => r.id === over.id);
    const newOrder = arrayMove(requirements, oldIndex, newIndex);

    // Optimistically update UI
    queryClient.setQueryData(['tenant-approval-requirements', tenantId], newOrder);

    // Persist new order
    const orderedIds = newOrder.map((r, index) => ({ id: r.id, sort_order: index + 1 }));
    reorderMutation.mutate(orderedIds);
  };

  const handleEdit = (req: ApprovalRequirement) => {
    setEditingRequirement(req);
    setEditLabel(req.label);
    setEditIcon(req.icon_name);
    setEditValidationType(req.validation_type);
    setEditDescription(req.description || '');
  };

  const handleSaveEdit = () => {
    if (!editingRequirement) return;
    updateMutation.mutate({
      id: editingRequirement.id,
      label: editLabel,
      icon_name: editIcon,
      validation_type: editValidationType,
      description: editDescription || null,
    });
    setEditingRequirement(null);
  };

  const handleToggleActive = (id: string, is_active: boolean) => {
    updateMutation.mutate({ id, is_active });
  };

  const handleToggleRequired = (id: string, is_required: boolean) => {
    updateMutation.mutate({ id, is_required });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this requirement?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleCreate = () => {
    if (!newLabel.trim()) {
      toast({ title: 'Label is required', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      label: newLabel,
      icon_name: newIcon,
      validation_type: newValidationType,
      description: newDescription,
      is_required: newIsRequired,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading approval requirements...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Approval Requirements
            </CardTitle>
            <CardDescription>
              Configure which requirements must be met before a lead can be approved to a project.
              Drag to reorder, toggle active/required status, or edit labels and icons.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Requirement
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {requirements.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No approval requirements configured.</p>
            <p className="text-sm">Click "Add Requirement" to create your first one.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={requirements.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {requirements.map((req) => (
                  <SortableItem
                    key={req.id}
                    requirement={req}
                    onEdit={handleEdit}
                    onToggleActive={handleToggleActive}
                    onToggleRequired={handleToggleRequired}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Edit Dialog */}
        {editingRequirement && (
          <Card className="mt-4 border-primary">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Edit Requirement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder="Requirement label"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Icon</Label>
                  <Popover open={iconPopoverOpen} onOpenChange={setIconPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start gap-2">
                        {(() => {
                          const IconComponent = getIcon(editIcon);
                          return <IconComponent className="h-4 w-4" />;
                        })()}
                        {editIcon}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2">
                      <ScrollArea className="h-48">
                        <div className="grid grid-cols-5 gap-1">
                          {availableIcons.map((iconName) => {
                            const IconComponent = getIcon(iconName);
                            return (
                              <Button
                                key={iconName}
                                variant={editIcon === iconName ? 'secondary' : 'ghost'}
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  setEditIcon(iconName);
                                  setIconPopoverOpen(false);
                                }}
                              >
                                <IconComponent className="h-4 w-4" />
                              </Button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Action Type</Label>
                <Select value={editValidationType} onValueChange={setEditValidationType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select action" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((action) => (
                      <SelectItem key={action.value} value={action.value}>
                        <div className="flex items-center gap-2">
                          <action.icon className="h-4 w-4" />
                          <span>{action.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {ACTION_TYPES.find(a => a.value === editValidationType)?.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Brief description of this requirement"
                  rows={2}
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveEdit} className="flex-1">
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingRequirement(null)}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-sm">
          <CheckCircle className="h-4 w-4 mt-0.5 text-primary" />
          <div className="text-muted-foreground">
            <strong>Active</strong> requirements are shown on the lead approval bubbles.{' '}
            <strong>Required</strong> requirements must be completed before the lead can be approved.
            Drag items to reorder how they appear.
          </div>
        </div>
      </CardContent>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Requirement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Label *</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g., Permit, Insurance, etc."
                />
              </div>
              <div className="space-y-2">
                <Label>Icon</Label>
                <Popover open={newIconPopoverOpen} onOpenChange={setNewIconPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      {(() => {
                        const IconComponent = getIcon(newIcon);
                        return <IconComponent className="h-4 w-4" />;
                      })()}
                      {newIcon}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2">
                    <ScrollArea className="h-48">
                      <div className="grid grid-cols-5 gap-1">
                        {availableIcons.map((iconName) => {
                          const IconComponent = getIcon(iconName);
                          return (
                            <Button
                              key={iconName}
                              variant={newIcon === iconName ? 'secondary' : 'ghost'}
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setNewIcon(iconName);
                                setNewIconPopoverOpen(false);
                              }}
                            >
                              <IconComponent className="h-4 w-4" />
                            </Button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Action Type</Label>
              <Select value={newValidationType} onValueChange={setNewValidationType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((action) => (
                    <SelectItem key={action.value} value={action.value}>
                      <div className="flex items-center gap-2">
                        <action.icon className="h-4 w-4" />
                        <span>{action.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ACTION_TYPES.find(a => a.value === newValidationType)?.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Brief description of this requirement"
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="new-is-required"
                checked={newIsRequired}
                onCheckedChange={setNewIsRequired}
              />
              <Label htmlFor="new-is-required">Required for approval</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              <Plus className="h-4 w-4 mr-2" />
              Add Requirement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
