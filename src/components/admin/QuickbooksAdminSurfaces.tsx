// QuickBooks Online — DEVELOPER / BACKEND TEMPLATE surface.
//
// This panel is intentionally NOT tenant-scoped. It configures the
// backend template that every tenant inherits when they connect their
// own QuickBooks account from their Company Profile → Integrations.
//
// What lives here:
//   1. Environment credentials status (sandbox + production client id /
//      secret / redirect URI presence — read from Supabase secrets).
//   2. The single webhook endpoint URL Intuit posts to (paste into the
//      Intuit developer dashboard once, all tenants share it).
//   3. Canonical Pitch job-type catalog — the template list every tenant
//      maps against inside their own settings.
//   4. Roster of tenants that have connected (read-only stats, no
//      per-tenant OAuth / mapping / webhook feed).
//
// Per-tenant OAuth connect, job-type → QBO item selection, active
// location, webhook feed, and sync-error triage live in the tenant's own
// Settings → Integrations → QuickBooks Online page — not here.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
  Layers,
  Building2,
  KeyRound,
  Webhook,
} from "lucide-react";

// Keep in sync with JobTypeQBOMapping.tsx (JOB_TYPES) and
// qbo-worker.createInvoiceFromJob's lookup. Editing this catalog is a
// backend template change and affects every tenant.
const JOB_TYPE_TEMPLATE: Array<{ code: string; label: string; description: string }> = [
  { code: "roof_repair", label: "Roof Repair", description: "Non-full-replacement roofing service work" },
  { code: "roof_replacement", label: "Roof Replacement", description: "Full tear-off / re-roof" },
  { code: "gutters", label: "Gutters", description: "Gutter install, repair, and gutter guards" },
  { code: "fascia", label: "Fascia", description: "Fascia board install, wrap, and repair" },
  { code: "siding", label: "Siding", description: "Siding install and repair" },
  { code: "windows", label: "Window Replacement", description: "Window replacement and repair" },
  { code: "doors", label: "Door Replacement", description: "Entry, patio, and interior door replacement" },
  { code: "interior_paint", label: "Interior Paint", description: "Interior painting work" },
  { code: "exterior_paint", label: "Exterior Paint", description: "Exterior painting work" },
  { code: "handyman", label: "Handyman", description: "General handyman services" },
  { code: "solar", label: "Solar", description: "Solar install and service" },
  { code: "insurance_supplement", label: "Insurance Supplement", description: "Supplement billing to carriers" },
];

interface TenantConnectionStat {
  tenant_id: string;
  tenant_name: string | null;
  realm_id: string;
  oauth_app_env: string | null;
  is_sandbox: boolean | null;
  connected_at: string | null;
  active_location_id: string | null;
}

export function QuickbooksAdminSurfaces() {
  const [secrets, setSecrets] = useState<Record<string, boolean> | null>(null);
  const [stats, setStats] = useState<TenantConnectionStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState<string>("");

  useEffect(() => {
    const projectRef = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID ?? "";
    if (projectRef) {
      setWebhookUrl(`https://${projectRef}.functions.supabase.co/qbo-webhook`);
    }
  }, []);

  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setStatusError(null);
      try {
        const { data, error } = await supabase.functions.invoke("qbo-worker", {
          body: { op: "backendTemplateStatus", args: {} },
        });
        if (cancelled) return;
        if (error) throw error;
        const payload = (data as any)?.data ?? data;
        setSecrets(payload?.secrets ?? null);
        setStats(Array.isArray(payload?.connections) ? payload.connections : []);
      } catch (e: any) {
        if (!cancelled) {
          setStatusError(
            e?.message ??
              "Backend status check failed (master role required).",
          );
          setSecrets(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const secretRows = useMemo(
    () => [
      { key: "QBO_CLIENT_ID_PRODUCTION", label: "Production client ID" },
      { key: "QBO_CLIENT_SECRET_PRODUCTION", label: "Production client secret" },
      { key: "QBO_REDIRECT_URI_PRODUCTION", label: "Production redirect URI" },
      { key: "QBO_CLIENT_ID_SANDBOX", label: "Sandbox client ID" },
      { key: "QBO_CLIENT_SECRET_SANDBOX", label: "Sandbox client secret" },
      { key: "QBO_REDIRECT_URI_SANDBOX", label: "Sandbox redirect URI" },
      { key: "QBO_WEBHOOK_VERIFIER_TOKEN", label: "Webhook verifier token" },
    ],
    [],
  );

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">
            QuickBooks Online — backend template (not tenant-specific)
          </CardTitle>
          <CardDescription>
            This is the developer surface for the QuickBooks integration
            template every tenant inherits. Tenants connect their own
            QuickBooks account, choose their environment, and map their job
            types from <span className="font-medium">Company Profile →
            Integrations → QuickBooks Online</span> — none of that happens
            here. Use this page to keep the shared credentials, webhook
            endpoint, and job-type catalog in a good state.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* 1. Shared Intuit app credentials (sandbox + production). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Intuit app credentials
          </CardTitle>
          <CardDescription>
            Set once as Supabase edge-function secrets. All tenants OAuth
            against these credentials — never store per-tenant client
            id/secret here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {statusError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Couldn't read live secret status ({statusError}). Rows below show{" "}
              <span className="font-medium">Unknown</span> instead of Missing —
              the actual secrets may already be configured in Supabase.
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Secret</TableHead>
                <TableHead>Env var</TableHead>
                <TableHead className="w-[140px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secretRows.map((row) => {
                const present = secrets?.[row.key];
                const unknown = secrets === null;
                return (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>
                      <code className="text-xs">{row.key}</code>
                    </TableCell>
                    <TableCell>
                      {loading ? (
                        <Badge variant="outline">Checking…</Badge>
                      ) : unknown ? (
                        <Badge variant="outline">Unknown</Badge>
                      ) : present ? (
                        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                          <CheckCircle2 className="h-3 w-3" /> Set
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" /> Missing
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 2. Shared webhook endpoint. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" /> Webhook endpoint (paste into Intuit)
          </CardTitle>
          <CardDescription>
            One URL, all tenants. Paste into the Intuit developer dashboard →
            Webhooks. Invoice / Payment / Customer events fan out to the
            correct tenant by realm ID inside the handler.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(webhookUrl, "Webhook URL")}
            >
              <Copy className="mr-2 h-3 w-3" /> Copy
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a
                href="https://developer.intuit.com/app/developer/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                Intuit dashboard <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Events subscribed: <code>Invoice</code>, <code>Payment</code>,{" "}
            <code>Customer</code>, <code>Item</code>. Signature verified with{" "}
            <code>QBO_WEBHOOK_VERIFIER_TOKEN</code>.
          </div>
        </CardContent>
      </Card>

      {/* 3. Canonical job-type catalog (backend template). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> Job-type catalog template
          </CardTitle>
          <CardDescription>
            Canonical list of Pitch job types every tenant maps against
            inside their own Settings. Edit this template only when adding a
            new company-wide job type — it changes the mapping surface for
            every tenant in one shot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {JOB_TYPE_TEMPLATE.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{row.code}</code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            To add/remove a job type, edit{" "}
            <code>JOB_TYPE_TEMPLATE</code> in{" "}
            <code>src/components/admin/QuickbooksAdminSurfaces.tsx</code> and{" "}
            <code>JOB_TYPES</code> in{" "}
            <code>src/components/settings/JobTypeQBOMapping.tsx</code> in the
            same PR.
          </p>
        </CardContent>
      </Card>

      {/* 4. Tenant connection roster (read-only). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Connected tenants
          </CardTitle>
          <CardDescription>
            Every tenant that has completed OAuth against the shared
            credentials above. Read-only — to manage a tenant's own
            connection, mapping, or webhook feed, open that tenant's own
            Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : stats.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tenants have connected QuickBooks yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Realm</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Connected</TableHead>
                  <TableHead>Active location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s) => (
                  <TableRow key={`${s.tenant_id}-${s.realm_id}`}>
                    <TableCell className="font-medium">
                      {s.tenant_name ?? s.tenant_id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{s.realm_id}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.is_sandbox ? "outline" : "default"}>
                        {s.oauth_app_env ?? (s.is_sandbox ? "sandbox" : "production")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.connected_at
                        ? new Date(s.connected_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.active_location_id ? (
                        <code>{s.active_location_id}</code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
