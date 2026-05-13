import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Settings, Trash2, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

export interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  default_due_offset_days: number | null;
  use_count: number;
}

interface TaskTemplatesManagerProps {
  trigger?: React.ReactNode;
  onChanged?: () => void;
}

const emptyDraft = {
  title: "",
  description: "",
  priority: "medium",
  default_due_offset_days: "" as string | number,
};

export const TaskTemplatesManager: React.FC<TaskTemplatesManagerProps> = ({
  trigger,
  onChanged,
}) => {
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("task_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("use_count", { ascending: false })
      .order("title", { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    setTemplates((data as TaskTemplate[]) || []);
  };

  useEffect(() => {
    if (open) load();
  }, [open, tenantId]);

  const beginEdit = (t: TaskTemplate) => {
    setEditingId(t.id);
    setCreating(false);
    setDraft({
      title: t.title,
      description: t.description || "",
      priority: t.priority,
      default_due_offset_days: t.default_due_offset_days ?? "",
    });
  };

  const beginCreate = () => {
    setEditingId(null);
    setCreating(true);
    setDraft(emptyDraft);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCreating(false);
    setDraft(emptyDraft);
  };

  const save = async () => {
    if (!tenantId) return;
    if (!draft.title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const payload = {
      tenant_id: tenantId,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      priority: draft.priority,
      default_due_offset_days:
        draft.default_due_offset_days === ""
          ? null
          : Number(draft.default_due_offset_days),
    };
    if (editingId) {
      const { error } = await supabase
        .from("task_templates")
        .update(payload)
        .eq("id", editingId);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Template updated" });
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("task_templates")
        .insert([{ ...payload, created_by: user?.id }]);
      if (error) {
        toast({ title: "Create failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Template created" });
    }
    cancelEdit();
    await load();
    onChanged?.();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    const { error } = await supabase.from("task_templates").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Template deleted" });
    await load();
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" /> Manage Templates
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-card">
        <DialogHeader>
          <DialogTitle>Task Templates</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="flex justify-end">
            {!creating && !editingId && (
              <Button size="sm" onClick={beginCreate}>
                <Plus className="h-4 w-4 mr-1" /> New Template
              </Button>
            )}
          </div>

          {(creating || editingId) && (
            <div className="border rounded-md p-3 space-y-3 bg-muted/30">
              <div>
                <label className="text-xs font-medium block mb-1">Title *</label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Build estimate"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Description</label>
                <Textarea
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Default Priority</label>
                  <Select
                    value={draft.priority}
                    onValueChange={(v) => setDraft({ ...draft, priority: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">
                    Default due in (days)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={draft.default_due_offset_days}
                    onChange={(e) =>
                      setDraft({ ...draft, default_due_offset_days: e.target.value })
                    }
                    placeholder="optional"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={cancelEdit}>
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={save}>
                  <Check className="h-4 w-4 mr-1" /> Save
                </Button>
              </div>
            </div>
          )}

          <div className="border rounded-md max-h-[400px] overflow-y-auto divide-y">
            {templates.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No templates yet. Create your first one to speed up task creation.
              </div>
            ) : (
              templates.map((t) => (
                <div key={t.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{t.title}</div>
                    {t.description && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {t.description}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Priority: {t.priority}
                      {t.default_due_offset_days != null &&
                        ` · Due in ${t.default_due_offset_days}d`}
                      {` · Used ${t.use_count}×`}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => beginEdit(t)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => remove(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TaskTemplatesManager;
