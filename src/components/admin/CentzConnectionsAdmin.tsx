// Master-only: Manage per-tenant Centz API connections.
// This is the BACKEND setup surface used by the developer (master role).
// Tenants never see this — they only see their own self-serve view in
// company settings once a connection has been provisioned here.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, KeyRound, Plus, Pencil, ShieldAlert, FlaskConical } from "lucide-react";

interface Tenant {
  id: string;
  name: string;
  subdomain: string | null;
  is_active: boolean;
}

interface CentzConnection {
  id: string;
  tenant_id: string;
  environment: "stage" | "production";
  api_access_token: string;
  api_version_path: string;
  merchant_id: string | null;
  site_external_id: string | null;
  agency_external_id: string | null;
  webhook_url: string | null;
  active: boolean;
  updated_at: string;
}

interface FormState {
  tenant_id: string;
  environment: "stage" | "production";
  api_access_token: string;
  api_version_path: string;
  merchant_id: string;
  site_external_id: string;
  agency_external_id: string;
  webhook_url: string;
  active: boolean;
}

const emptyForm = (): FormState => ({
  tenant_id: "",
  environment: "stage",
  api_access_token: "",
  api_version_path: "/api/v3.1",
  merchant_id: "",
  site_external_id: "",
  agency_external_id: "",
  webhook_url: "",
  active: true,
});

export function CentzConnectionsAdmin() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [connections, setConnections] = useState<CentzConnection[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [tRes, cRes] = await Promise.all([
        supabase.from("tenants").select("id,name,subdomain,is_active").order("name"),
        // Connections table is master-read only via RLS.
        (supabase as any).from("centz_connections").select("*").order("updated_at", { ascending: false }),
      ]);
      if (tRes.error) throw tRes.error;
      if (cRes.error) throw cRes.error;
      setTenants((tRes.data || []) as Tenant[]);
      setConnections((cRes.data || []) as CentzConnection[]);
    } catch (e: any) {
      toast({ title: "Failed to load Centz connections", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (c: CentzConnection) => {
    setEditingId(c.id);
    setForm({
      tenant_id: c.tenant_id,
      environment: c.environment,
      api_access_token: c.api_access_token,
      api_version_path: c.api_version_path || "/api/v3.1",
      merchant_id: c.merchant_id || "",
      site_external_id: c.site_external_id || "",
      agency_external_id: c.agency_external_id || "",
      webhook_url: c.webhook_url || "",
      active: c.active,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.tenant_id) {
      toast({ title: "Tenant required", variant: "destructive" });
      return;
    }
    if (!form.api_access_token || !form.merchant_id || !form.site_external_id) {
      toast({
        title: "Missing required fields",
        description: "API token, merchant ID, and site external ID are required.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        tenant_id: form.tenant_id,
        environment: form.environment,
        api_access_token: form.api_access_token.trim(),
        api_version_path: form.api_version_path.trim() || "/api/v3.1",
        merchant_id: form.merchant_id.trim(),
        site_external_id: form.site_external_id.trim(),
        agency_external_id: form.agency_external_id.trim() || null,
        webhook_url: form.webhook_url.trim() || null,
        active: form.active,
      };

      let res;
      if (editingId) {
        res = await (supabase as any)
          .from("centz_connections")
          .update(payload)
          .eq("id", editingId);
      } else {
        // Upsert by (tenant_id, environment) so re-saving updates instead of duplicating.
        res = await (supabase as any)
          .from("centz_connections")
          .upsert(payload, { onConflict: "tenant_id,environment" });
      }
      if (res.error) throw res.error;
      toast({ title: editingId ? "Centz connection updated" : "Centz connection saved" });
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: CentzConnection) => {
    if (!confirm(`Delete Centz ${c.environment} connection for this tenant? This cannot be undone.`)) return;
    try {
      const { error } = await (supabase as any).from("centz_connections").delete().eq("id", c.id);
      if (error) throw error;
      toast({ title: "Connection deleted" });
      await load();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const test = async (c: CentzConnection) => {
    setTesting(c.id);
    try {
      // Calls payment-api ping for this tenant. Switching active tenant is
      // required for the route to scope correctly; for now we just round-trip
      // a minimal $1 invoice/get against an obviously-missing id to confirm
      // auth headers reach Centz (expected: 404 from Centz, not 401).
      const { data, error } = await supabase.functions.invoke("payment-api", {
        body: {
          path: "/centz/invoice/get",
          external_id: `__ping_${Date.now()}`,
          _admin_tenant_override: c.tenant_id,
        },
      });
      if (error) throw error;
      toast({
        title: "Ping sent",
        description: `Centz responded. status=${(data as any)?.status ?? "ok"}`,
      });
    } catch (e: any) {
      toast({ title: "Ping failed", description: e.message, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  };

  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.name || id;
  const maskToken = (t: string) => (t ? `${t.slice(0, 4)}••••${t.slice(-4)}` : "");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Centz Connections (Developer)
          </CardTitle>
          <CardDescription className="mt-1 max-w-2xl">
            Master-only. Provision the Centz API credentials per tenant here so each company can
            create invoice payment links. Tenants do not see this screen — they only see a
            read-only status indicator in their own settings.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> New Connection
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : connections.length === 0 ? (
          <div className="border border-dashed rounded-lg p-10 text-center text-muted-foreground">
            <ShieldAlert className="h-8 w-8 mx-auto mb-3 opacity-60" />
            No Centz connections configured yet. Click <strong>New Connection</strong> to seed one
            for a tenant using the Centz stage credentials.
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((c) => (
              <div
                key={c.id}
                className="border rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{tenantName(c.tenant_id)}</span>
                    <Badge variant={c.environment === "production" ? "default" : "secondary"}>
                      {c.environment}
                    </Badge>
                    {c.active ? (
                      <Badge className="bg-green-600 hover:bg-green-600">active</Badge>
                    ) : (
                      <Badge variant="outline">inactive</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    token {maskToken(c.api_access_token)} · merchant {c.merchant_id || "—"} · site{" "}
                    {c.site_external_id || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => test(c)}
                    disabled={testing === c.id}
                  >
                    {testing === c.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FlaskConical className="h-4 w-4 mr-1" />
                    )}
                    Test
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(c)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Centz connection" : "New Centz connection"}
            </DialogTitle>
            <DialogDescription>
              Developer-only. Stored server-side; tenants never read this token.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tenant</Label>
              <Select
                value={form.tenant_id}
                onValueChange={(v) => setForm((f) => ({ ...f, tenant_id: v }))}
                disabled={!!editingId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant…" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {t.is_active ? "" : "(inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select
                  value={form.environment}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, environment: v as "stage" | "production" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stage">Stage</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>API Version Path</Label>
                <Input
                  value={form.api_version_path}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, api_version_path: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>API Access Token</Label>
              <Input
                type="password"
                placeholder="Centz x-access-token"
                value={form.api_access_token}
                onChange={(e) =>
                  setForm((f) => ({ ...f, api_access_token: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Merchant ID</Label>
                <Input
                  value={form.merchant_id}
                  onChange={(e) => setForm((f) => ({ ...f, merchant_id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Site External ID</Label>
                <Input
                  value={form.site_external_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, site_external_id: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Agency External ID (optional)</Label>
              <Input
                value={form.agency_external_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, agency_external_id: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Webhook URL (optional)</Label>
              <Input
                placeholder="https://…/functions/v1/centz-webhook"
                value={form.webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium text-sm">Active</div>
                <div className="text-xs text-muted-foreground">
                  Inactive connections are ignored by the payment API.
                </div>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Create connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default CentzConnectionsAdmin;
