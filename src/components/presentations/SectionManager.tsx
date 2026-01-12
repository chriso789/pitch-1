import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { 
  GripVertical, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X,
  Home,
  FileText,
  Camera,
  DollarSign,
  Shield,
  Users,
  Clock,
  Star,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const ICON_OPTIONS = [
  { value: "home", label: "Home", icon: Home },
  { value: "file-text", label: "Document", icon: FileText },
  { value: "camera", label: "Camera", icon: Camera },
  { value: "dollar-sign", label: "Dollar", icon: DollarSign },
  { value: "shield", label: "Shield", icon: Shield },
  { value: "users", label: "Users", icon: Users },
  { value: "clock", label: "Clock", icon: Clock },
  { value: "star", label: "Star", icon: Star },
];

const COLOR_OPTIONS = [
  { value: "#3b82f6", label: "Blue" },
  { value: "#10b981", label: "Green" },
  { value: "#f59e0b", label: "Yellow" },
  { value: "#ef4444", label: "Red" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#6b7280", label: "Gray" },
];

interface Section {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  section_order: number;
  is_visible: boolean;
  presentation_id: string;
}

interface SectionItemProps {
  section: Section;
  onEdit: (section: Section) => void;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string, visible: boolean) => void;
}

const SectionItem = ({ section, onEdit, onDelete, onToggleVisibility }: SectionItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const IconComponent = ICON_OPTIONS.find(i => i.value === section.icon)?.icon || FileText;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-3 p-3 border rounded-lg bg-card transition-all",
        !section.is_visible && "opacity-50"
      )}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      
      <div 
        className="h-8 w-8 rounded-md flex items-center justify-center"
        style={{ backgroundColor: section.color || "#3b82f6" }}
      >
        <IconComponent className="h-4 w-4 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{section.name}</p>
        <p className="text-xs text-muted-foreground">/{section.slug}</p>
      </div>

      <Switch
        checked={section.is_visible}
        onCheckedChange={(checked) => onToggleVisibility(section.id, checked)}
      />

      <Button variant="ghost" size="icon" onClick={() => onEdit(section)}>
        <Edit2 className="h-4 w-4" />
      </Button>

      <Button 
        variant="ghost" 
        size="icon" 
        className="text-destructive hover:text-destructive"
        onClick={() => onDelete(section.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};

interface SectionManagerProps {
  presentationId: string;
}

export const SectionManager = ({ presentationId }: SectionManagerProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    icon: "file-text",
    color: "#3b82f6",
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { data: sections = [], isLoading } = useQuery({
    queryKey: ["presentation-sections", presentationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_sections")
        .select("*")
        .eq("presentation_id", presentationId)
        .order("section_order", { ascending: true });
      if (error) throw error;
      return data as Section[];
    },
  });

  const createSectionMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("presentation_sections").insert({
        presentation_id: presentationId,
        name: data.name,
        slug: data.slug,
        icon: data.icon,
        color: data.color,
        section_order: sections.length,
        is_visible: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presentation-sections", presentationId] });
      toast({ title: "Section created", description: "New section has been added." });
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create section", description: error.message, variant: "destructive" });
    },
  });

  const updateSectionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Section> }) => {
      const { error } = await supabase
        .from("presentation_sections")
        .update(data)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presentation-sections", presentationId] });
      toast({ title: "Section updated", description: "Changes have been saved." });
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update section", description: error.message, variant: "destructive" });
    },
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("presentation_sections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presentation-sections", presentationId] });
      toast({ title: "Section deleted", description: "Section has been removed." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete section", description: error.message, variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (newSections: Section[]) => {
      const updates = newSections.map((section, index) =>
        supabase
          .from("presentation_sections")
          .update({ section_order: index })
          .eq("id", section.id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presentation-sections", presentationId] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to reorder sections", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", slug: "", icon: "file-text", color: "#3b82f6" });
    setEditingSection(null);
    setIsDialogOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSection) {
      updateSectionMutation.mutate({ id: editingSection.id, data: formData });
    } else {
      createSectionMutation.mutate(formData);
    }
  };

  const handleEdit = (section: Section) => {
    setEditingSection(section);
    setFormData({
      name: section.name,
      slug: section.slug,
      icon: section.icon || "file-text",
      color: section.color || "#3b82f6",
    });
    setIsDialogOpen(true);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      const newSections = arrayMove(sections, oldIndex, newIndex);
      reorderMutation.mutate(newSections);
    }
  };

  const handleToggleVisibility = (id: string, visible: boolean) => {
    updateSectionMutation.mutate({ id, data: { is_visible: visible } });
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  };

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading sections...</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Sections</h3>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => resetForm()}>
              <Plus className="h-4 w-4 mr-1" />
              Add Section
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSection ? "Edit Section" : "Create Section"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      name: e.target.value,
                      slug: editingSection ? formData.slug : generateSlug(e.target.value),
                    });
                  }}
                  placeholder="e.g., About Us"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: generateSlug(e.target.value) })}
                  placeholder="e.g., about-us"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="icon">Icon</Label>
                <Select
                  value={formData.icon}
                  onValueChange={(value) => setFormData({ ...formData, icon: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <option.icon className="h-4 w-4" />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <Select
                  value={formData.color}
                  onValueChange={(value) => setFormData({ ...formData, color: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="h-4 w-4 rounded-full" 
                            style={{ backgroundColor: option.value }}
                          />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingSection ? "Save Changes" : "Create Section"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p className="mb-2">No sections yet</p>
          <p className="text-sm">Create sections to organize your slides</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {sections.map((section) => (
                <SectionItem
                  key={section.id}
                  section={section}
                  onEdit={handleEdit}
                  onDelete={(id) => deleteSectionMutation.mutate(id)}
                  onToggleVisibility={handleToggleVisibility}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};
