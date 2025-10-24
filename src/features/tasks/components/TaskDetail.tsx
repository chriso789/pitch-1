import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Calendar, User, Clock, CheckCircle2, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface TaskDetailProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TaskDetail({ taskId, open, onOpenChange }: TaskDetailProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const { data, error } = await supabase
        .from('workflow_tasks')
        .select(`
          *,
          profiles:assigned_to(full_name, email),
          contacts(first_name, last_name),
          projects(title)
        `)
        .eq('id', taskId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!taskId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name');
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from('workflow_tasks')
        .update(updates)
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-tasks'] });
      toast({ title: "Task updated successfully" });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error updating task", description: error.message, variant: "destructive" });
    },
  });

  const handleQuickUpdate = (field: string, value: any) => {
    updateMutation.mutate({ [field]: value });
  };

  if (!task || isLoading) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading task...</p>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Task Details</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Task Name */}
          <div className="space-y-2">
            <Label>Task Name</Label>
            {isEditing ? (
              <Input
                defaultValue={task.task_name}
                onBlur={(e) => handleQuickUpdate('task_name', e.target.value)}
              />
            ) : (
              <p className="text-lg font-semibold">{task.task_name}</p>
            )}
          </div>

          {/* Status & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={task.status}
                onValueChange={(value) => handleQuickUpdate('status', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={task.priority || 'medium'}
                onValueChange={(value) => handleQuickUpdate('priority', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assigned To */}
          <div className="space-y-2">
            <Label>Assigned To</Label>
            <Select
              value={task.assigned_to || ''}
              onValueChange={(value) => handleQuickUpdate('assigned_to', value || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unassigned</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name} ({user.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input
              type="date"
              value={task.due_date ? format(new Date(task.due_date), 'yyyy-MM-dd') : ''}
              onChange={(e) => handleQuickUpdate('due_date', e.target.value || null)}
            />
          </div>

          {/* Context Information */}
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-semibold text-sm">Context</h4>
            
            {task.clj_number && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{task.clj_number}</Badge>
              </div>
            )}

            {task.contacts && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>{task.contacts.first_name} {task.contacts.last_name}</span>
              </div>
            )}

            {task.projects && (
              <div className="flex items-center gap-2 text-sm">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <span>{task.projects.title}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Phase: {task.phase}</span>
            </div>
          </div>

          {/* AI Context */}
          {task.ai_context && (
            <div className="space-y-2">
              <Label>AI Insights</Label>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md text-sm">
                {typeof task.ai_context === 'string' 
                  ? task.ai_context 
                  : JSON.stringify(task.ai_context, null, 2)}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? 'Done Editing' : 'Edit'}
            </Button>
            {task.status !== 'completed' && (
              <Button
                className="flex-1"
                onClick={() => handleQuickUpdate('status', 'completed')}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Complete Task
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
