import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Clock, AlertTriangle, Users } from "lucide-react";

interface EscalationLevel {
  level: number;
  after_minutes: number;
  notify_user_ids: string[];
  notify_roles: string[];
  action: string;
}

interface SLAPolicy {
  id: string;
  tenant_id: string;
  name: string;
  channel: string | null;
  first_response_minutes: number;
  resolution_minutes: number;
  escalation_levels: EscalationLevel[] | any;
  business_hours_only: boolean;
  business_hours: any;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

const defaultEscalationLevel: EscalationLevel = {
  level: 1,
  after_minutes: 30,
  notify_user_ids: [],
  notify_roles: ["manager"],
  action: "notify"
};

export const SLAPolicyManager = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SLAPolicy | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    channel: "all",
    priority: "all",
    first_response_minutes: 30,
    resolution_minutes: 480,
    business_hours_only: true,
    is_active: true,
    escalation_levels: [defaultEscalationLevel]
  });

  // Fetch SLA policies
  const { data: policies, isLoading } = useQuery({
    queryKey: ["sla-policies", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("sla_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return (data || []) as SLAPolicy[];
    },
    enabled: !!tenantId
  });

  // Fetch team members for escalation
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("tenant_id", tenantId);
      
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!tenantId) throw new Error("No tenant ID");
      
      const payload = {
        tenant_id: tenantId,
        name: data.name,
        channel: data.channel === "all" ? null : data.channel,
        first_response_minutes: data.first_response_minutes,
        resolution_minutes: data.resolution_minutes,
        escalation_levels: JSON.parse(JSON.stringify(data.escalation_levels)),
        business_hours_only: data.business_hours_only,
        is_active: data.is_active
      };

      if (editingPolicy) {
        const { error } = await supabase
          .from("sla_policies")
          .update(payload)
          .eq("id", editingPolicy.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("sla_policies")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sla-policies"] });
      toast.success(editingPolicy ? "SLA policy updated" : "SLA policy created");
      handleCloseDialog();
    },
    onError: (error) => {
      toast.error("Failed to save SLA policy: " + error.message);
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sla_policies")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sla-policies"] });
      toast.success("SLA policy deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete: " + error.message);
    }
  });

  // Toggle active status
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("sla_policies")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sla-policies"] });
    }
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingPolicy(null);
    setFormData({
      name: "",
      description: "",
      channel: "all",
      priority: "all",
      first_response_minutes: 30,
      resolution_minutes: 480,
      business_hours_only: true,
      is_active: true,
      escalation_levels: [defaultEscalationLevel]
    });
  };

  const handleEdit = (policy: SLAPolicy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      description: "",
      channel: policy.channel || "all",
      priority: "all",
      first_response_minutes: policy.first_response_minutes,
      resolution_minutes: policy.resolution_minutes,
      business_hours_only: policy.business_hours_only,
      is_active: policy.is_active,
      escalation_levels: (policy.escalation_levels as unknown as EscalationLevel[]) || [defaultEscalationLevel]
    });
    setIsDialogOpen(true);
  };

  const addEscalationLevel = () => {
    const newLevel = formData.escalation_levels.length + 1;
    setFormData({
      ...formData,
      escalation_levels: [
        ...formData.escalation_levels,
        { ...defaultEscalationLevel, level: newLevel, after_minutes: newLevel * 30 }
      ]
    });
  };

  const updateEscalationLevel = (index: number, updates: Partial<EscalationLevel>) => {
    const updated = [...formData.escalation_levels];
    updated[index] = { ...updated[index], ...updates };
    setFormData({ ...formData, escalation_levels: updated });
  };

  const removeEscalationLevel = (index: number) => {
    setFormData({
      ...formData,
      escalation_levels: formData.escalation_levels.filter((_, i) => i !== index)
    });
  };

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">SLA Policies</h3>
          <p className="text-sm text-muted-foreground">
            Define response time targets and escalation rules for conversations
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Policy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPolicy ? "Edit SLA Policy" : "Create SLA Policy"}</DialogTitle>
              <DialogDescription>
                Configure response time targets and automatic escalation rules
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Policy Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Standard Support"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="channel">Channel</Label>
                    <Select
                      value={formData.channel}
                      onValueChange={(value) => setFormData({ ...formData, channel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Channels</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="call">Phone Call</SelectItem>
                        <SelectItem value="web">Web Chat</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe when this policy applies..."
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select
                      value={formData.priority}
                      onValueChange={(value) => setFormData({ ...formData, priority: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Priorities</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2 pt-6">
                    <Switch
                      id="business_hours"
                      checked={formData.business_hours_only}
                      onCheckedChange={(checked) => setFormData({ ...formData, business_hours_only: checked })}
                    />
                    <Label htmlFor="business_hours">Business hours only</Label>
                  </div>
                </div>
              </div>

              {/* Response Time Targets */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Response Time Targets
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first_response">First Response (minutes)</Label>
                      <Input
                        id="first_response"
                        type="number"
                        min="1"
                        value={formData.first_response_minutes}
                        onChange={(e) => setFormData({ ...formData, first_response_minutes: parseInt(e.target.value) || 30 })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Time to first reply: {formatMinutes(formData.first_response_minutes)}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="resolution">Resolution (minutes)</Label>
                      <Input
                        id="resolution"
                        type="number"
                        min="1"
                        value={formData.resolution_minutes}
                        onChange={(e) => setFormData({ ...formData, resolution_minutes: parseInt(e.target.value) || 480 })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Time to resolve: {formatMinutes(formData.resolution_minutes)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Escalation Levels */}
              <Card>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Escalation Levels
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={addEscalationLevel}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add Level
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {formData.escalation_levels.map((level, index) => (
                    <div key={index} className="flex items-start gap-4 p-3 border rounded-lg bg-muted/30">
                      <Badge variant="outline" className="mt-1">L{level.level}</Badge>
                      <div className="flex-1 grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">After (minutes)</Label>
                          <Input
                            type="number"
                            min="1"
                            value={level.after_minutes}
                            onChange={(e) => updateEscalationLevel(index, { after_minutes: parseInt(e.target.value) || 30 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Notify Roles</Label>
                          <Select
                            value={level.notify_roles[0] || "manager"}
                            onValueChange={(value) => updateEscalationLevel(index, { notify_roles: [value] })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="owner">Owner</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Action</Label>
                          <Select
                            value={level.action}
                            onValueChange={(value) => updateEscalationLevel(index, { action: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="notify">Notify Only</SelectItem>
                              <SelectItem value="reassign">Reassign</SelectItem>
                              <SelectItem value="urgent">Mark Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {formData.escalation_levels.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 mt-5"
                          onClick={() => removeEscalationLevel(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active">Policy is active</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog}>Cancel</Button>
              <Button
                onClick={() => saveMutation.mutate(formData)}
                disabled={!formData.name || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : editingPolicy ? "Update Policy" : "Create Policy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Policies Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>First Response</TableHead>
                <TableHead>Resolution</TableHead>
                <TableHead>Escalations</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading policies...
                  </TableCell>
                </TableRow>
              ) : !policies?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No SLA policies configured. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                policies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{policy.name}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{policy.channel || "All"}</Badge>
                    </TableCell>
                    <TableCell>{formatMinutes(policy.first_response_minutes)}</TableCell>
                    <TableCell>{formatMinutes(policy.resolution_minutes)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {(policy.escalation_levels as unknown as EscalationLevel[])?.length || 0} levels
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={policy.is_active}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: policy.id, is_active: checked })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(policy)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Delete this SLA policy?")) {
                              deleteMutation.mutate(policy.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
