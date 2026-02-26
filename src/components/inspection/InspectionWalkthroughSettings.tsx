import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  GripVertical,
  Pencil,
  Trash2,
  Plus,
  RotateCcw,
  Camera,
  Shield,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useInspectionConfig,
  useInspectionConfigMutations,
  type InspectionStepConfig,
} from '@/hooks/useInspectionConfig';

// ─── Sortable step card ───

function SortableStepCard({
  step,
  onEdit,
  onDelete,
  totalActive,
}: {
  step: InspectionStepConfig;
  onEdit: (s: InspectionStepConfig) => void;
  onDelete: (s: InspectionStepConfig) => void;
  totalActive: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border rounded-lg p-3 bg-background hover:bg-muted/30 transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{step.title}</span>
          {step.is_required && (
            <Badge variant="destructive" className="text-[10px] h-5 gap-1">
              <Shield className="h-3 w-3" />
              Required
            </Badge>
          )}
          {step.min_photos > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 gap-1">
              <Camera className="h-3 w-3" />
              Min {step.min_photos}
            </Badge>
          )}
        </div>
        {step.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{step.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(step)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => onDelete(step)}
          disabled={totalActive <= 1}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Edit / Add dialog ───

interface StepFormData {
  title: string;
  description: string;
  guidance: string[];
  is_required: boolean;
  min_photos: number;
}

function StepEditDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: StepFormData | null;
  onSave: (data: StepFormData) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<StepFormData>(
    initial || { title: '', description: '', guidance: [''], is_required: false, min_photos: 0 }
  );

  React.useEffect(() => {
    if (open && initial) setForm(initial);
    else if (open) setForm({ title: '', description: '', guidance: [''], is_required: false, min_photos: 0 });
  }, [open, initial]);

  const addGuidance = () => setForm((f) => ({ ...f, guidance: [...f.guidance, ''] }));
  const removeGuidance = (i: number) =>
    setForm((f) => ({ ...f, guidance: f.guidance.filter((_, idx) => idx !== i) }));
  const updateGuidance = (i: number, val: string) =>
    setForm((f) => ({ ...f, guidance: f.guidance.map((g, idx) => (idx === i ? val : g)) }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Step' : 'Add New Step'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Roof Vents"
            />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Brief instruction for the field rep"
              className="min-h-[60px]"
            />
          </div>

          <div>
            <Label className="mb-2 block">Guidance Bullets</Label>
            <div className="space-y-2">
              {form.guidance.map((g, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={g}
                    onChange={(e) => updateGuidance(i, e.target.value)}
                    placeholder={`Guidance ${i + 1}`}
                    className="flex-1"
                  />
                  {form.guidance.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeGuidance(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addGuidance} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> Add Bullet
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <Label className="text-sm font-medium">Required Step</Label>
              <p className="text-xs text-muted-foreground">Rep must take photos before proceeding</p>
            </div>
            <Switch
              checked={form.is_required}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_required: v }))}
            />
          </div>

          {form.is_required && (
            <div>
              <Label>Minimum Photos Required</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={form.min_photos || 1}
                onChange={(e) => setForm((f) => ({ ...f, min_photos: Math.max(1, parseInt(e.target.value) || 1) }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Rep must take at least this many photos for this step
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!form.title.trim()) {
                toast.error('Title is required');
                return;
              }
              const cleanGuidance = form.guidance.filter((g) => g.trim());
              onSave({
                ...form,
                guidance: cleanGuidance.length > 0 ? cleanGuidance : [''],
                min_photos: form.is_required ? Math.max(1, form.min_photos) : 0,
              });
            }}
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {initial ? 'Save Changes' : 'Add Step'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main settings component ───

export function InspectionWalkthroughSettings() {
  const { steps, isLoading } = useInspectionConfig();
  const { updateStep, addStep, deleteStep, reorderSteps, resetToDefaults } =
    useInspectionConfigMutations();

  const [editingStep, setEditingStep] = useState<InspectionStepConfig | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [deletingStep, setDeletingStep] = useState<InspectionStepConfig | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(steps, oldIndex, newIndex);
    reorderSteps.mutate(reordered.map((s) => s.id));
  };

  const handleEditSave = (data: StepFormData) => {
    if (!editingStep) return;
    updateStep.mutate(
      {
        id: editingStep.id,
        title: data.title,
        description: data.description,
        guidance: data.guidance,
        is_required: data.is_required,
        min_photos: data.min_photos,
      },
      {
        onSuccess: () => {
          toast.success('Step updated');
          setEditingStep(null);
        },
        onError: () => toast.error('Failed to update step'),
      }
    );
  };

  const handleAddSave = (data: StepFormData) => {
    addStep.mutate(
      {
        ...data,
        order_index: steps.length,
      },
      {
        onSuccess: () => {
          toast.success('Step added');
          setAddingStep(false);
        },
        onError: () => toast.error('Failed to add step'),
      }
    );
  };

  const handleDelete = () => {
    if (!deletingStep) return;
    deleteStep.mutate(deletingStep.id, {
      onSuccess: () => {
        toast.success('Step removed');
        setDeletingStep(null);
      },
      onError: () => toast.error('Failed to remove step'),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Inspection Walkthrough Steps
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Customize the steps your field reps follow during property inspections. Drag to reorder.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setResetConfirmOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reset Defaults
            </Button>
            <Button size="sm" onClick={() => setAddingStep(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Step
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {steps.map((step) => (
                <SortableStepCard
                  key={step.id}
                  step={step}
                  onEdit={setEditingStep}
                  onDelete={setDeletingStep}
                  totalActive={steps.length}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {steps.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No steps configured. Click "Reset Defaults" to load the standard 11 steps.
          </div>
        )}
      </CardContent>

      {/* Edit dialog */}
      <StepEditDialog
        open={!!editingStep}
        onClose={() => setEditingStep(null)}
        initial={
          editingStep
            ? {
                title: editingStep.title,
                description: editingStep.description || '',
                guidance: editingStep.guidance?.length ? editingStep.guidance : [''],
                is_required: editingStep.is_required,
                min_photos: editingStep.min_photos,
              }
            : null
        }
        onSave={handleEditSave}
        saving={updateStep.isPending}
      />

      {/* Add dialog */}
      <StepEditDialog
        open={addingStep}
        onClose={() => setAddingStep(false)}
        initial={null}
        onSave={handleAddSave}
        saving={addStep.isPending}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingStep} onOpenChange={(o) => !o && setDeletingStep(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Step</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deletingStep?.title}" from the inspection walkthrough? This won't affect completed inspections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset confirmation */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Defaults</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all current steps with the standard 11 inspection steps. Custom steps will be deactivated. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetToDefaults.mutate(undefined, { onSettled: () => setResetConfirmOpen(false) });
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
