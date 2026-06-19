import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar, Clock, Wrench, Camera, Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

export interface LaborOrderStatus {
  id: string;
  key: string;
  label: string;
  color: string;
  sort_order: number;
  is_terminal: boolean;
  requires_date: boolean;
}

export interface ChecklistItem {
  id: string;
  status_id: string;
  label: string;
  is_required: boolean;
  sort_order: number;
}

interface CrewOption { id: string; name: string }

interface Props {
  order: any;
  statuses: LaborOrderStatus[];
  crews: CrewOption[];
  isStaff: boolean;
  myCrewId?: string | null;
  onUploadPhoto: (assignmentId: string) => void;
  onChanged: () => void;
}

export function LaborOrderCard({ order, statuses, crews, isStaff, myCrewId, onUploadPhoto, onChanged }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingCrew, setPendingCrew] = useState<string>("");
  const [dateDraft, setDateDraft] = useState<string>(order.scheduled_date || "");

  const project = order.projects;
  const jobNumber = project?.clj_formatted_number || project?.job_number || project?.project_number || "—";

  const currentStatus = statuses.find(s => s.key === order.status);
  const canEditStatus = isStaff || (myCrewId && order.crew_id === myCrewId);
  const canEditCrew = isStaff;
  const requiresDate = currentStatus?.requires_date;

  const { data: checklistItems = [] } = useQuery({
    queryKey: ["lo-checklist-items", currentStatus?.id],
    queryFn: async (): Promise<ChecklistItem[]> => {
      if (!currentStatus?.id) return [];
      const { data, error } = await supabase
        .from("labor_order_checklist_items")
        .select("id, status_id, label, is_required, sort_order")
        .eq("status_id", currentStatus.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentStatus?.id && expanded,
  });

  const { data: completions = [], refetch: refetchCompletions } = useQuery({
    queryKey: ["lo-checklist-completions", order.id, currentStatus?.id],
    queryFn: async (): Promise<{ item_id: string }[]> => {
      if (!currentStatus?.id) return [];
      const { data, error } = await supabase
        .from("labor_order_checklist_completions")
        .select("item_id")
        .eq("assignment_id", order.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentStatus?.id && expanded,
  });
  const completedSet = new Set(completions.map(c => c.item_id));

  const updateField = async (patch: Record<string, any>) => {
    setSaving(true);
    const { error } = await supabase
      .from("production_order_assignments")
      .update(patch)
      .eq("id", order.id);
    setSaving(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return false;
    }
    onChanged();
    return true;
  };

  const handleStatusChange = async (newKey: string) => {
    const target = statuses.find(s => s.key === newKey);
    if (!target) return;
    const patch: any = { status: newKey };
    if (!target.requires_date) {
      // keep scheduled_date as-is unless leaving scheduled clears explicit need
    }
    const ok = await updateField(patch);
    if (ok) toast({ title: "Status updated", description: target.label });
  };

  const handleDateSave = async () => {
    if (!dateDraft) return;
    const ok = await updateField({ scheduled_date: dateDraft, status: "scheduled" });
    if (ok) toast({ title: "Scheduled", description: format(new Date(dateDraft + "T12:00:00"), "MMM d, yyyy") });
  };

  const handleAssignCrew = async () => {
    if (!pendingCrew) return;
    const ok = await updateField({ crew_id: pendingCrew });
    if (ok) {
      setPendingCrew("");
      toast({ title: "Crew assigned" });
    }
  };

  const toggleChecklistItem = async (item: ChecklistItem) => {
    if (completedSet.has(item.id)) {
      const { error } = await supabase
        .from("labor_order_checklist_completions")
        .delete()
        .eq("assignment_id", order.id)
        .eq("item_id", item.id);
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      const { error } = await supabase
        .from("labor_order_checklist_completions")
        .insert({
          tenant_id: order.tenant_id,
          assignment_id: order.id,
          item_id: item.id,
        });
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    }
    refetchCompletions();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-[10px] font-mono">Job #{jobNumber}</Badge>
              {project?.name && <span className="text-xs text-muted-foreground truncate">{project.name}</span>}
            </div>
            <h3 className="font-medium text-sm">{order.title}</h3>
            {order.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{order.description}</p>
            )}
          </div>
          <Badge
            variant="outline"
            style={currentStatus ? { backgroundColor: currentStatus.color + "20", color: currentStatus.color, borderColor: currentStatus.color + "40" } : undefined}
          >
            {currentStatus?.label || order.status}
          </Badge>
        </div>

        {/* Inline controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Status select */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</label>
            <Select
              value={order.status || ""}
              onValueChange={handleStatusChange}
              disabled={!canEditStatus || saving}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Set status…" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map(s => (
                  <SelectItem key={s.id} value={s.key} className="text-xs">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Crew select */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Crew</label>
            <div className="flex gap-1">
              <Select
                value={pendingCrew || order.crew_id || ""}
                onValueChange={(v) => setPendingCrew(v)}
                disabled={!canEditCrew || saving}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {crews.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEditCrew && pendingCrew && pendingCrew !== order.crew_id && (
                <Button size="sm" className="h-8 px-2" onClick={handleAssignCrew} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Date row for scheduled */}
        {(requiresDate || order.scheduled_date) && (
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Scheduled date
            </label>
            <div className="flex gap-1">
              <Input
                type="date"
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
                className="h-8 text-xs"
                disabled={!canEditStatus || saving}
              />
              {dateDraft && dateDraft !== order.scheduled_date && (
                <Button size="sm" className="h-8 px-2" onClick={handleDateSave} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => onUploadPhoto(order.id)}>
            <Camera className="h-3 w-3 mr-1" /> Photo
          </Button>
          {currentStatus?.id && (
            <Button size="sm" variant="ghost" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              Checklist
            </Button>
          )}
          {isStaff && order.crews?.name && (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Wrench className="h-3 w-3" /> {order.crews.name}
            </span>
          )}
          {order.scheduled_date && (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {format(new Date(order.scheduled_date + "T12:00:00"), "MMM d")}
            </span>
          )}
        </div>

        {/* Checklist */}
        {expanded && currentStatus && (
          <div className="bg-muted/40 rounded p-2 space-y-1">
            {checklistItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No checklist items for "{currentStatus.label}".</p>
            ) : checklistItems.map(item => {
              const done = completedSet.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => toggleChecklistItem(item)}
                  className="w-full flex items-center gap-2 text-left text-xs py-1 px-1 hover:bg-background/50 rounded"
                >
                  <span className={`w-4 h-4 inline-flex items-center justify-center rounded border ${done ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                    {done && <Check className="h-3 w-3" />}
                  </span>
                  <span className={done ? 'line-through text-muted-foreground' : ''}>{item.label}</span>
                  {item.is_required && <span className="text-[10px] text-amber-600 ml-auto">required</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans bg-muted/30 rounded p-2">
            {order.notes}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
