import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Mail, Star, Loader2 } from "lucide-react";

export const ESTIMATE_TEMPLATE_TYPE = "estimate_send";

export const ESTIMATE_TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: "customer_name", label: "Customer full name" },
  { key: "customer_first_name", label: "Customer first name" },
  { key: "estimate_number", label: "Estimate number" },
  { key: "estimate_name", label: "Estimate display name" },
  { key: "sender_name", label: "Your name (sales rep)" },
  { key: "company_name", label: "Your company name" },
];

interface EstimateEmailTemplate {
  id: string;
  name: string;
  subject: string;
  html_body: string;
  is_default: boolean | null;
  is_active: boolean | null;
  tenant_id: string | null;
}

const DEFAULT_SUBJECT = "Your Estimate #{{estimate_number}} from {{company_name}}";
const DEFAULT_BODY = `Hi {{customer_first_name}},

Thanks for the opportunity! I've attached your estimate ({{estimate_name}}) for review.

Please click the link in this email to view the full quote. Let me know if you have any questions — I'm happy to walk through it with you.

Best,
{{sender_name}}
{{company_name}}`;

export function EstimateEmailTemplates() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<EstimateEmailTemplate | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["estimate-email-templates", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("template_type", ESTIMATE_TEMPLATE_TYPE)
        .eq("tenant_id", tenantId)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as EstimateEmailTemplate[];
    },
    enabled: !!tenantId,
  });

  const saveMutation = useMutation({
    mutationFn: async (tpl: EstimateEmailTemplate) => {
      if (!tenantId) throw new Error("Missing tenant");

      // If marking default, clear others first
      if (tpl.is_default) {
        await supabase
          .from("email_templates")
          .update({ is_default: false })
          .eq("template_type", ESTIMATE_TEMPLATE_TYPE)
          .eq("tenant_id", tenantId)
          .neq("id", tpl.id || "00000000-0000-0000-0000-000000000000");
      }

      const payload = {
        name: tpl.name,
        subject: tpl.subject,
        html_body: tpl.html_body,
        is_default: !!tpl.is_default,
        is_active: tpl.is_active !== false,
        template_type: ESTIMATE_TEMPLATE_TYPE,
        tenant_id: tenantId,
        variables: ESTIMATE_TEMPLATE_VARIABLES.map((v) => v.key),
      };

      if (tpl.id) {
        const { error } = await supabase
          .from("email_templates")
          .update(payload)
          .eq("id", tpl.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("email_templates")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimate-email-templates"] });
      setIsOpen(false);
      setEditing(null);
      toast({ title: "Template saved" });
    },
    onError: (e: any) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimate-email-templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const openNew = () => {
    setEditing({
      id: "",
      name: "",
      subject: DEFAULT_SUBJECT,
      html_body: DEFAULT_BODY,
      is_default: !templates || templates.length === 0,
      is_active: true,
      tenant_id: tenantId,
    });
    setIsOpen(true);
  };

  const openEdit = (t: EstimateEmailTemplate) => {
    setEditing({ ...t });
    setIsOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Estimate Email Templates
          </CardTitle>
          <CardDescription>
            Reusable email templates your sales reps can pick when sending estimates.
            Variables like <code>{"{{customer_first_name}}"}</code> auto-fill on send.
          </CardDescription>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !templates || templates.length === 0 ? (
          <div className="text-center py-8 border border-dashed rounded-lg">
            <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              No estimate templates yet. Create one so your team isn't retyping the same email.
            </p>
            <Button onClick={openNew} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" /> Create your first template
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/40 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{t.name}</p>
                    {t.is_default && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="h-3 w-3" /> Default
                      </Badge>
                    )}
                    {t.is_active === false && (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Delete template "${t.name}"?`)) deleteMutation.mutate(t.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Template" : "New Estimate Email Template"}</DialogTitle>
            <DialogDescription>
              Use variables in double curly braces. They'll be replaced when a rep sends the estimate.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input
                  placeholder="e.g. Standard Estimate Follow-up"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email Subject</Label>
                <Input
                  value={editing.subject}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email Body</Label>
                <Textarea
                  rows={10}
                  value={editing.html_body}
                  onChange={(e) => setEditing({ ...editing, html_body: e.target.value })}
                  className="font-mono text-sm"
                />
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs font-medium mb-2">Available variables (click to copy):</p>
                <div className="flex flex-wrap gap-1">
                  {ESTIMATE_TEMPLATE_VARIABLES.map((v) => {
                    const token = `{{${v.key}}}`;
                    return (
                      <button
                        key={v.key}
                        type="button"
                        className="text-xs px-2 py-1 rounded bg-background border hover:bg-accent transition"
                        onClick={() => {
                          navigator.clipboard.writeText(token);
                          toast({ title: "Copied", description: token });
                        }}
                        title={v.label}
                      >
                        {token}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm font-medium">Default template</Label>
                  <p className="text-xs text-muted-foreground">
                    Auto-selected when a rep opens the send dialog.
                  </p>
                </div>
                <Switch
                  checked={!!editing.is_default}
                  onCheckedChange={(c) => setEditing({ ...editing, is_default: c })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm font-medium">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Inactive templates are hidden from the send dialog.
                  </p>
                </div>
                <Switch
                  checked={editing.is_active !== false}
                  onCheckedChange={(c) => setEditing({ ...editing, is_active: c })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={!editing?.name?.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Render an estimate template by substituting {{variables}} with values.
 * Unknown tokens are left blank.
 */
export function renderEstimateTemplate(
  text: string,
  vars: Record<string, string | undefined | null>,
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}
