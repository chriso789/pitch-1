// Master-only: External integrations hub.
// Replaces the old "Centz" tab. Lists every outside-company integration
// (ABC Supply, SRS, QuickBooks, Centz, ...) with a global on/off toggle,
// sandbox flag, connected-tenant count, sandbox test, and a Manage drawer
// that embeds the existing per-integration admin surface.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plug,
  Plus,
  ExternalLink,
  FlaskConical,
  Loader2,
  Settings2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Power,
} from "lucide-react";
import { CentzConnectionsAdmin } from "@/components/admin/CentzConnectionsAdmin";
import { IntegrationSandboxConsole } from "@/components/admin/IntegrationSandboxConsole";
import { AbcAdminSurfaces } from "@/components/admin/AbcAdminSurfaces";
import { SrsAdminSurfaces } from "@/components/admin/SrsAdminSurfaces";
import { QuickbooksAdminSurfaces } from "@/components/admin/QuickbooksAdminSurfaces";

interface PlatformIntegration {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  enabled: boolean;
  sandbox_mode: boolean;
  status: string;
  docs_url: string | null;
  notes: string | null;
  connections_table: string | null;
  last_checked_at: string | null;
}

const CATEGORY_OPTIONS = [
  { value: "supplier", label: "Supplier" },
  { value: "accounting", label: "Accounting" },
  { value: "payments", label: "Payments" },
  { value: "messaging", label: "Messaging" },
  { value: "measurement", label: "Measurement" },
  { value: "other", label: "Other" },
];

function statusBadge(status: string) {
  switch (status) {
    case "operational":
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-600">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Operational
        </Badge>
      );
    case "degraded":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-500 text-black">
          <AlertTriangle className="h-3 w-3 mr-1" /> Degraded
        </Badge>
      );
    case "down":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" /> Down
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function IntegrationsAdmin() {
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<PlatformIntegration[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingSlug, setTestingSlug] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    slug: "",
    name: "",
    category: "supplier",
    description: "",
    docs_url: "",
    connections_table: "",
  });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_integrations" as any)
      .select("*")
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      toast({
        title: "Couldn't load integrations",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    const rows = (data as unknown as PlatformIntegration[]) ?? [];
    setIntegrations(rows);

    // Tenant connection counts (best-effort per integration)
    const nextCounts: Record<string, number> = {};
    await Promise.all(
      rows.map(async (row) => {
        if (!row.connections_table) return;
        const { count } = await supabase
          .from(row.connections_table as any)
          .select("id", { count: "exact", head: true });
        nextCounts[row.slug] = count ?? 0;
      })
    );
    setCounts(nextCounts);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, PlatformIntegration[]> = {};
    for (const i of integrations) {
      (out[i.category] ||= []).push(i);
    }
    return out;
  }, [integrations]);

  const updateRow = async (
    id: string,
    patch: Partial<PlatformIntegration>
  ) => {
    setSavingId(id);
    const { error } = await supabase
      .from("platform_integrations" as any)
      .update(patch as any)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setIntegrations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } as PlatformIntegration : r))
    );
  };

  const runSandboxTest = async (row: PlatformIntegration) => {
    setTestingSlug(row.slug);
    let ok = false;
    let detail = "";
    try {
      // Lightweight ping: count rows in the integration's connection table.
      // This proves DB connectivity + that the connections surface exists.
      // Provider-specific live checks live inside each Manage panel.
      if (row.connections_table) {
        const { error, count } = await supabase
          .from(row.connections_table as any)
          .select("id", { count: "exact", head: true });
        if (error) throw error;
        ok = true;
        detail = `${count ?? 0} tenant connection(s) reachable`;
      } else {
        ok = true;
        detail = "No backing table — toggle/state only";
      }
      await updateRow(row.id, {
        status: "operational",
        last_checked_at: new Date().toISOString() as any,
      } as any);
      toast({
        title: `${row.name}: sandbox OK`,
        description: detail,
      });
    } catch (e: any) {
      await updateRow(row.id, {
        status: "degraded",
        last_checked_at: new Date().toISOString() as any,
      } as any);
      toast({
        title: `${row.name}: sandbox failed`,
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTestingSlug(null);
    }
  };

  const createIntegration = async () => {
    if (!newForm.slug.trim() || !newForm.name.trim()) {
      toast({
        title: "Slug and name are required",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("platform_integrations" as any).insert({
      slug: newForm.slug.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      name: newForm.name.trim(),
      category: newForm.category,
      description: newForm.description.trim() || null,
      docs_url: newForm.docs_url.trim() || null,
      connections_table: newForm.connections_table.trim() || null,
      enabled: true,
      sandbox_mode: true,
      status: "operational",
    } as any);
    setCreating(false);
    if (error) {
      toast({
        title: "Couldn't add integration",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setAddOpen(false);
    setNewForm({
      slug: "",
      name: "",
      category: "supplier",
      description: "",
      docs_url: "",
      connections_table: "",
    });
    await load();
  };

  const currentOpen = integrations.find((i) => i.slug === openSlug) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Plug className="h-6 w-6" />
            External Integrations
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Developer hub for all outside-company integrations. Toggle a
            platform on/off for every tenant at once, flip sandbox mode, run a
            connectivity check, and open the per-tenant management surface.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Integration
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations…
        </div>
      ) : (
        Object.entries(grouped).map(([category, rows]) => (
          <section key={category} className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {CATEGORY_OPTIONS.find((c) => c.value === category)?.label ??
                category}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <Card key={row.id} className={!row.enabled ? "opacity-70" : ""}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {row.name}
                          {row.sandbox_mode && (
                            <Badge variant="outline" className="text-[10px]">
                              SANDBOX
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {row.description || "—"}
                        </CardDescription>
                      </div>
                      {statusBadge(row.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Connected tenants
                      </span>
                      <span className="font-medium">
                        {counts[row.slug] ?? "—"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm flex items-center gap-2">
                          <Power className="h-3.5 w-3.5" />
                          Enabled platform-wide
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Hides the integration for every tenant when off.
                        </p>
                      </div>
                      <Switch
                        checked={row.enabled}
                        disabled={savingId === row.id}
                        onCheckedChange={(v) =>
                          updateRow(row.id, { enabled: v })
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm flex items-center gap-2">
                          <FlaskConical className="h-3.5 w-3.5" />
                          Sandbox mode
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Route calls to the provider's test environment.
                        </p>
                      </div>
                      <Switch
                        checked={row.sandbox_mode}
                        disabled={savingId === row.id}
                        onCheckedChange={(v) =>
                          updateRow(row.id, { sandbox_mode: v })
                        }
                      />
                    </div>

                    {row.last_checked_at && (
                      <p className="text-[11px] text-muted-foreground">
                        Last checked{" "}
                        {new Date(row.last_checked_at).toLocaleString()}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runSandboxTest(row)}
                        disabled={testingSlug === row.slug}
                      >
                        {testingSlug === row.slug ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <FlaskConical className="h-3.5 w-3.5 mr-1" />
                        )}
                        Test
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setOpenSlug(row.slug)}
                      >
                        <Settings2 className="h-3.5 w-3.5 mr-1" /> Manage
                      </Button>
                      {row.docs_url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                        >
                          <a
                            href={row.docs_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Docs
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}

      <Sheet
        open={!!openSlug}
        onOpenChange={(v) => !v && setOpenSlug(null)}
      >
        <SheetContent className="w-full sm:max-w-5xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {currentOpen?.name ?? "Integration"} — per-tenant connections
            </SheetTitle>
            <SheetDescription>
              {currentOpen?.description ??
                "Manage tenant-level credentials and connection state."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {currentOpen && (
              <IntegrationSandboxConsole
                slug={currentOpen.slug}
                name={currentOpen.name}
              />
            )}

            {currentOpen?.slug === "abc_supply" ? (
              <AbcAdminSurfaces />
            ) : currentOpen?.slug === "srs" ? (
              <SrsAdminSurfaces />
            ) : currentOpen?.slug === "centz" ? (
              <CentzConnectionsAdmin />
            ) : currentOpen ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {currentOpen.name} tenant connections
                  </CardTitle>
                  <CardDescription>
                    {currentOpen.connections_table
                      ? `Backed by table: ${currentOpen.connections_table}. Per-tenant credential setup lives in each tenant's Settings → Integrations page; this hub controls the platform-wide toggle and sandbox state.`
                      : "No backing table is registered for this integration yet."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Connected tenants</span>
                    <span className="font-medium">
                      {counts[currentOpen.slug] ?? 0}
                    </span>
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      defaultValue={currentOpen.notes ?? ""}
                      onBlur={(e) =>
                        updateRow(currentOpen.id, { notes: e.target.value })
                      }
                      placeholder="Developer notes, support contacts, rollout plan…"
                      className="mt-1"
                    />
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a new integration</DialogTitle>
            <DialogDescription>
              Register a new outside-company integration so it shows up here for
              every tenant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={newForm.name}
                onChange={(e) =>
                  setNewForm({ ...newForm, name: e.target.value })
                }
                placeholder="e.g. Beacon Building Products"
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={newForm.slug}
                onChange={(e) =>
                  setNewForm({ ...newForm, slug: e.target.value })
                }
                placeholder="beacon"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={newForm.category}
                onValueChange={(v) =>
                  setNewForm({ ...newForm, category: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={newForm.description}
                onChange={(e) =>
                  setNewForm({ ...newForm, description: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Docs URL</Label>
                <Input
                  value={newForm.docs_url}
                  onChange={(e) =>
                    setNewForm({ ...newForm, docs_url: e.target.value })
                  }
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label>Connections table</Label>
                <Input
                  value={newForm.connections_table}
                  onChange={(e) =>
                    setNewForm({
                      ...newForm,
                      connections_table: e.target.value,
                    })
                  }
                  placeholder="beacon_connections"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAddOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={createIntegration} disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default IntegrationsAdmin;
