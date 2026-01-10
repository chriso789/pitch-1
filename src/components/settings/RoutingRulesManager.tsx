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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Route, Users, ArrowUpDown } from "lucide-react";

interface Conditions {
  keywords?: string[];
  channels?: string[];
  source?: string[];
  priority?: string[];
}

interface RoutingRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  routing_type: string;
  conditions: Conditions | null;
  eligible_user_ids: string[] | null;
  fallback_user_id: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
}

const routingTypes = [
  { value: "round_robin", label: "Round Robin", description: "Distribute evenly across team" },
  { value: "least_busy", label: "Least Busy", description: "Assign to agent with fewest active conversations" },
  { value: "skill_based", label: "Skill Based", description: "Route based on agent skills" },
  { value: "manager_only", label: "Manager Only", description: "Route only to managers" },
  { value: "specific_user", label: "Specific User", description: "Always route to specific person" }
];

export const RoutingRulesManager = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    routing_type: "round_robin",
    conditions: {
      keywords: [] as string[],
      channels: [] as string[],
      priority: [] as string[]
    },
    eligible_user_ids: [] as string[],
    fallback_user_id: "",
    priority: 0,
    is_active: true
  });

  const [keywordInput, setKeywordInput] = useState("");

  // Fetch routing rules
  const { data: rules, isLoading } = useQuery({
    queryKey: ["routing-rules", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("conversation_routing_rules")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("priority", { ascending: true }) as { data: RoutingRule[] | null; error: any };
      
      if (error) throw error;
      return data as RoutingRule[];
    },
    enabled: !!tenantId
  });

  // Fetch team members
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, role")
        .eq("tenant_id", tenantId) as { data: { id: string; first_name: string; last_name: string; role: string }[] | null; error: any };
      
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
        description: data.description || null,
        routing_type: data.routing_type,
        conditions: data.conditions,
        eligible_user_ids: data.eligible_user_ids.length > 0 ? data.eligible_user_ids : null,
        fallback_user_id: data.fallback_user_id || null,
        priority: data.priority,
        is_active: data.is_active
      };

      if (editingRule) {
        const { error } = await supabase
          .from("conversation_routing_rules")
          .update(payload)
          .eq("id", editingRule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("conversation_routing_rules")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      toast.success(editingRule ? "Routing rule updated" : "Routing rule created");
      handleCloseDialog();
    },
    onError: (error) => {
      toast.error("Failed to save routing rule: " + error.message);
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("conversation_routing_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      toast.success("Routing rule deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete: " + error.message);
    }
  });

  // Toggle active status
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("conversation_routing_rules")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
    }
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingRule(null);
    setFormData({
      name: "",
      description: "",
      routing_type: "round_robin",
      conditions: { keywords: [], channels: [], priority: [] },
      eligible_user_ids: [],
      fallback_user_id: "",
      priority: 0,
      is_active: true
    });
    setKeywordInput("");
  };

  const handleEdit = (rule: RoutingRule) => {
    setEditingRule(rule);
    const conditions = (rule.conditions as Conditions) || { keywords: [], channels: [], priority: [] };
    setFormData({
      name: rule.name,
      description: rule.description || "",
      routing_type: rule.routing_type,
      conditions: {
        keywords: conditions.keywords || [],
        channels: conditions.channels || [],
        priority: conditions.priority || []
      },
      eligible_user_ids: rule.eligible_user_ids || [],
      fallback_user_id: rule.fallback_user_id || "",
      priority: rule.priority,
      is_active: rule.is_active
    });
    setIsDialogOpen(true);
  };

  const addKeyword = () => {
    if (keywordInput.trim() && !formData.conditions.keywords.includes(keywordInput.trim())) {
      setFormData({
        ...formData,
        conditions: {
          ...formData.conditions,
          keywords: [...formData.conditions.keywords, keywordInput.trim()]
        }
      });
      setKeywordInput("");
    }
  };

  const removeKeyword = (keyword: string) => {
    setFormData({
      ...formData,
      conditions: {
        ...formData.conditions,
        keywords: formData.conditions.keywords.filter(k => k !== keyword)
      }
    });
  };

  const toggleChannel = (channel: string) => {
    const current = formData.conditions.channels;
    const updated = current.includes(channel)
      ? current.filter(c => c !== channel)
      : [...current, channel];
    setFormData({
      ...formData,
      conditions: { ...formData.conditions, channels: updated }
    });
  };

  const toggleEligibleUser = (userId: string) => {
    const current = formData.eligible_user_ids;
    const updated = current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId];
    setFormData({ ...formData, eligible_user_ids: updated });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Routing Rules</h3>
          <p className="text-sm text-muted-foreground">
            Configure how conversations are automatically assigned to team members
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRule ? "Edit Routing Rule" : "Create Routing Rule"}</DialogTitle>
              <DialogDescription>
                Define conditions and assignment logic for incoming conversations
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Rule Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Sales Inquiries"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority (lower = higher priority)</Label>
                    <Input
                      id="priority"
                      type="number"
                      min="0"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe when this rule applies..."
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Routing Type</Label>
                  <Select
                    value={formData.routing_type}
                    onValueChange={(value) => setFormData({ ...formData, routing_type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {routingTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex flex-col">
                            <span>{type.label}</span>
                            <span className="text-xs text-muted-foreground">{type.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Conditions */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Route className="h-4 w-4" />
                    Matching Conditions
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Leave empty to match all conversations
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Channels */}
                  <div className="space-y-2">
                    <Label className="text-xs">Channels</Label>
                    <div className="flex flex-wrap gap-2">
                      {["sms", "email", "call", "web"].map((channel) => (
                        <label key={channel} className="flex items-center gap-2">
                          <Checkbox
                            checked={formData.conditions.channels.includes(channel)}
                            onCheckedChange={() => toggleChannel(channel)}
                          />
                          <span className="text-sm capitalize">{channel}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Keywords */}
                  <div className="space-y-2">
                    <Label className="text-xs">Keywords (message contains)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        placeholder="Type keyword and press Add"
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
                      />
                      <Button type="button" variant="outline" onClick={addKeyword}>Add</Button>
                    </div>
                    {formData.conditions.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {formData.conditions.keywords.map((keyword) => (
                          <Badge key={keyword} variant="secondary" className="cursor-pointer" onClick={() => removeKeyword(keyword)}>
                            {keyword} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Eligible Users */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Eligible Team Members
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Select who can receive conversations from this rule
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {teamMembers?.map((member) => (
                      <label key={member.id} className="flex items-center gap-2 p-2 rounded border hover:bg-muted/50">
                        <Checkbox
                          checked={formData.eligible_user_ids.includes(member.id)}
                          onCheckedChange={() => toggleEligibleUser(member.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{member.full_name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Fallback User (if no one available)</Label>
                    <Select
                      value={formData.fallback_user_id}
                      onValueChange={(value) => setFormData({ ...formData, fallback_user_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select fallback..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {teamMembers?.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active">Rule is active</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog}>Cancel</Button>
              <Button
                onClick={() => saveMutation.mutate(formData)}
                disabled={!formData.name || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : editingRule ? "Update Rule" : "Create Rule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rules Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <ArrowUpDown className="h-4 w-4" />
                </TableHead>
                <TableHead>Rule Name</TableHead>
                <TableHead>Routing Type</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading rules...
                  </TableCell>
                </TableRow>
              ) : !rules?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No routing rules configured. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((rule) => {
                  const conditions = rule.conditions as Conditions;
                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Badge variant="outline">{rule.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{rule.name}</p>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{rule.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {routingTypes.find(t => t.value === rule.routing_type)?.label || rule.routing_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {conditions?.channels?.map((c) => (
                            <Badge key={c} variant="outline" className="text-xs capitalize">{c}</Badge>
                          ))}
                          {conditions?.keywords?.length ? (
                            <Badge variant="outline" className="text-xs">
                              {conditions.keywords.length} keywords
                            </Badge>
                          ) : null}
                          {!conditions?.channels?.length && !conditions?.keywords?.length && (
                            <span className="text-xs text-muted-foreground">All</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {rule.eligible_user_ids?.length || 0} users
                        </span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.is_active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, is_active: checked })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(rule)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm("Delete this routing rule?")) {
                                deleteMutation.mutate(rule.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
