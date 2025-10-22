import React, { useState, useEffect } from "react";
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
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { TEST_IDS } from "../../tests/utils/test-ids";

interface TaskAssignmentDialogProps {
  trigger?: React.ReactNode;
  contactId?: string;
  pipelineEntryId?: string;
  projectId?: string;
  onTaskCreated?: (task: any) => void;
  buttonText?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
}

export const TaskAssignmentDialog: React.FC<TaskAssignmentDialogProps> = ({
  trigger,
  contactId,
  pipelineEntryId,
  projectId,
  onTaskCreated,
  buttonText = "Assign Task",
  buttonVariant = "default",
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "medium",
    due_date: "",
    assigned_to: "",
  });

  useEffect(() => {
    if (open) {
      fetchTenantUsers();
    }
  }, [open]);

  const fetchTenantUsers = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile?.tenant_id) throw new Error("No tenant found");

      const { data: tenantUsers, error: usersError } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .eq("tenant_id", profile.tenant_id)
        .order("first_name");

      if (usersError) throw usersError;

      const usersList = tenantUsers?.map((u) => ({
        id: u.id,
        name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email || "Unknown User",
        email: u.email || "",
      })) || [];

      setUsers(usersList);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast({
        title: "Error",
        description: "Failed to load users",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast({
        title: "Validation Error",
        description: "Task title is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.assigned_to) {
      toast({
        title: "Validation Error",
        description: "Please assign the task to a user",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile?.tenant_id) throw new Error("No tenant found");

      const taskData = {
        tenant_id: profile.tenant_id,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        priority: formData.priority,
        status: "pending",
        due_date: formData.due_date || null,
        assigned_to: formData.assigned_to,
        created_by: user.id,
        contact_id: contactId || null,
        pipeline_entry_id: pipelineEntryId || null,
        project_id: projectId || null,
        ai_generated: false,
      };

      const { data, error } = await supabase
        .from("tasks")
        .insert([taskData])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Task Created",
        description: `Task "${formData.title}" has been assigned successfully.`,
      });

      // Reset form
      setFormData({
        title: "",
        description: "",
        priority: "medium",
        due_date: "",
        assigned_to: "",
      });

      setOpen(false);
      onTaskCreated?.(data);
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create task",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      title: "",
      description: "",
      priority: "medium",
      due_date: "",
      assigned_to: "",
    });
    setOpen(false);
  };

  const defaultTrigger = (
    <Button variant={buttonVariant} className="shadow-soft transition-smooth">
      <CheckCircle2 className="h-4 w-4 mr-2" />
      {buttonText}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild data-testid={TEST_IDS.tasks?.createButton}>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-card border shadow-strong">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Assign New Task
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Task Title */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Task Title *</label>
            <Input
              data-testid={TEST_IDS.tasks?.titleInput}
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Enter task title..."
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Textarea
              data-testid={TEST_IDS.tasks?.descriptionInput}
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Add task details..."
              rows={3}
            />
          </div>

          {/* Priority and Due Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Priority</label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, priority: value }))}
              >
                <SelectTrigger data-testid={TEST_IDS.tasks?.prioritySelect}>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Due Date</label>
              <Input
                data-testid={TEST_IDS.tasks?.dueDateInput}
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData((prev) => ({ ...prev, due_date: e.target.value }))}
              />
            </div>
          </div>

          {/* Assign To */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Assign To *</label>
            <Select
              value={formData.assigned_to}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, assigned_to: value }))}
            >
              <SelectTrigger data-testid={TEST_IDS.tasks?.assignToSelect}>
                <SelectValue placeholder="Select user to assign task..." />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} {user.email && `(${user.email})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Context Display */}
          {(contactId || pipelineEntryId || projectId) && (
            <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
              <strong>Linked to:</strong>{" "}
              {contactId && "Contact"}{pipelineEntryId && "Lead"}{projectId && "Job"}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={loading}
              className="flex-1"
              data-testid={TEST_IDS.tasks?.submitButton}
            >
              {loading ? "Creating Task..." : "Create Task"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
              data-testid={TEST_IDS.tasks?.cancelButton}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TaskAssignmentDialog;
