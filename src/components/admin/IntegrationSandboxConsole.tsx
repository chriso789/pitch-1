// Master-only sandbox console for an external integration.
// Shows recent request/response payloads from supplier_audit_log and lets
// the developer fire a test invocation against the integration's edge
// function, then inspect the raw response.

import { useCallback, useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ExternalLink,
  FlaskConical,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";

interface AuditRow {
  id: string;
  created_at: string;
  supplier: string;
  action: string;
  result: string;
  tenant_id: string;
  tenant_name?: string | null;
  request_id: string | null;
  metadata: any;
}

interface SandboxPreset {
  edgeFunction: string;
  bodyTemplate: Record<string, unknown>;
  description: string;
}

// Slug → which edge function the "Send test payload" panel pings.
// Bodies are intentionally safe sandbox calls (list / ping / dry-run).
const PRESETS: Record<string, SandboxPreset> = {
  abc_supply: {
    edgeFunction: "abc-api-proxy",
    // Canonical ABC sandbox order dry-run. `validate_payload_only` runs the
    // full ABC catalog + pricing + order-shape validation used by the real
    // "Push to ABC" flow, without submitting a live order. This mirrors the
    // payload structure wired up during O'Brien Contracting sandbox testing
    // (POST /order/v2/orders body, shipToNumber 2010466-2, branch 1209).
    bodyTemplate: {
      action: "validate_payload_only",
      environment: "sandbox",
      sandboxDemo: true,
      shipToNumber: "2010466-2",
      branchNumber: "1209",
      itemNumber: "02OCTDUMP",
      itemDescription: "Sandbox Demo Item 02OCTDUMP",
      uom: "EA",
      quantity: 1,
      jobsiteContact: {
        name: "Pitch Sandbox Tester",
        email: "sandbox@pitch-crm.ai",
        phone: "555-010-0000",
      },
      priceOverride: null,
    },
    description:
      "Calls abc-api-proxy with action:'validate_payload_only' — runs the full ABC catalog + pricing + order-shape validation against the sandbox WAF using the O'Brien-verified ship-to / branch / demo item. Does NOT submit a live order. Switch to action:'submit_test_order' to actually POST to /order/v2/orders in sandbox.",
  },
  srs: {
    edgeFunction: "srs-api-proxy",
    bodyTemplate: { action: "validate_connection" },
    description:
      "Calls srs-api-proxy with action:'validate_connection' — fetches an SRS access token and validates the active tenant's customer account against SRS SIPS.",
  },
  qxo: {
    edgeFunction: "qxo-api",
    bodyTemplate: { __route: "/health", sandbox: true },
    description:
      "Calls qxo-api /health — verifies QXO/Beacon credentials & scopes for the active tenant.",
  },
  quickbooks: {
    edgeFunction: "qbo-oauth-connect",
    bodyTemplate: { action: "verify" },
    description:
      "Calls qbo-oauth-connect with action:'verify' — checks the active tenant's QuickBooks OAuth connection, refresh-token window, and legal acceptance status. Uses Intuit's OpenID discovery document at runtime for OAuth endpoints.",
  },
  centz: {
    edgeFunction: "payment-api",
    bodyTemplate: { __route: "/centz/ping", sandbox: true },
    description: "Pings the Centz payment API health route.",
  },
};

// Map UI slug to the supplier value written into supplier_audit_log.
const AUDIT_SUPPLIER: Record<string, string> = {
  abc_supply: "abc",
  srs: "srs",
  qxo: "qxo",
  quickbooks: "qbo",
  centz: "centz",
};

interface Props {
  slug: string;
  name: string;
}

export function IntegrationSandboxConsole({ slug, name }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const preset = PRESETS[slug];
  const [bodyText, setBodyText] = useState(
    preset ? JSON.stringify(preset.bodyTemplate, null, 2) : "{}",
  );
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status?: number;
    data?: unknown;
    error?: string;
    ms: number;
  } | null>(null);

  const auditSupplier = AUDIT_SUPPLIER[slug] ?? slug;

  const load = useCallback(async () => {
    setLoading(true);
    // Master-only cross-tenant view: routes through admin-supplier-audit,
    // which reads with service role so historical sandbox testing performed
    // inside the O'Brien Contracting tenant (when these connections were
    // first wired up) is visible regardless of which tenant the master is
    // currently switched into.
    const { data, error } = await supabase.functions.invoke(
      "admin-supplier-audit",
      {
        body: {
          supplier: auditSupplier,
          action: filter.trim() || undefined,
          limit: 100,
        },
      },
    );
    setLoading(false);
    if (error) {
      toast({
        title: "Couldn't load audit feed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    if (data && (data as any).ok === false) {
      toast({
        title: "Couldn't load audit feed",
        description: (data as any).error ?? "unknown",
        variant: "destructive",
      });
      return;
    }
    setRows(((data as any)?.rows ?? []) as AuditRow[]);
  }, [auditSupplier, filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const sendTest = async () => {
    if (!preset) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e: any) {
      toast({
        title: "Invalid JSON",
        description: e.message,
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    setTestResult(null);
    const t0 = performance.now();
    const { data, error } = await supabase.functions.invoke(
      preset.edgeFunction,
      { body: parsed },
    );
    const ms = Math.round(performance.now() - t0);
    setSending(false);
    if (error) {
      setTestResult({ ok: false, error: error.message, ms });
      return;
    }
    setTestResult({ ok: true, data, ms });
    // refresh audit feed — most edge fns write an audit row
    setTimeout(load, 600);
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="feed" className="w-full">
        <TabsList>
          <TabsTrigger value="feed">
            <ArrowDownToLine className="h-3.5 w-3.5 mr-1" />
            Payload feed
          </TabsTrigger>
          <TabsTrigger value="test">
            <FlaskConical className="h-3.5 w-3.5 mr-1" />
            Send test payload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feed" className="space-y-3 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-base">
                    Recent {name} payloads
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Cross-tenant view from <code>supplier_audit_log</code>{" "}
                    (supplier = <code>{auditSupplier}</code>) — includes the
                    original sandbox testing performed in O'Brien Contracting
                    when this connection was first wired up. Latest 100.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filter by action…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-8 w-44"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={load}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] pr-3">
                {rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-12 text-center">
                    {loading
                      ? "Loading…"
                      : "No audit rows yet for this integration."}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rows.map((r) => (
                      <PayloadRow key={r.id} row={r} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-3 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-base">Send sandbox payload</CardTitle>
                  <CardDescription className="text-xs">
                    {preset
                      ? preset.description
                      : "No sandbox preset is registered for this integration. Add one in IntegrationSandboxConsole.tsx → PRESETS."}
                  </CardDescription>
                </div>
                {slug === "abc_supply" && (
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.functions.invoke(
                            "abc-api-proxy",
                            {
                              body: {
                                action: "start_oauth",
                                environment: "sandbox",
                                return_origin: window.location.origin,
                                return_path:
                                  window.location.pathname + window.location.search,
                              },
                            },
                          );
                          if (error) throw new Error(error.message);
                          if (!data?.success || !data?.authorization_url) {
                            throw new Error(
                              data?.human_message ||
                                data?.error_code ||
                                "Could not build ABC authorize URL",
                            );
                          }
                          window.open(
                            data.authorization_url,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        } catch (e: any) {
                          toast({
                            title: "ABC sandbox login unavailable",
                            description:
                              e?.message ||
                              "start_oauth failed — check ABC_CLIENT_ID_SANDBOX / secret / redirect config.",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      ABC sandbox login
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href="https://my.abcsupply.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        myABCsupply (contractor)
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {preset && (
                <div className="text-xs flex items-center gap-2">
                  <Badge variant="outline">edge fn</Badge>
                  <code>{preset.edgeFunction}</code>
                </div>
              )}
              <div>
                <Label className="text-xs">Request body (JSON)</Label>
                <Textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={8}
                  className="mt-1 font-mono text-xs"
                  disabled={!preset}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={sendTest}
                  disabled={!preset || sending}
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5 mr-1" />
                  )}
                  Send
                </Button>
                {testResult && (
                  <Badge
                    variant={testResult.ok ? "default" : "destructive"}
                    className={
                      testResult.ok
                        ? "bg-emerald-600 hover:bg-emerald-600"
                        : ""
                    }
                  >
                    {testResult.ok ? "OK" : "FAIL"} · {testResult.ms}ms
                  </Badge>
                )}
              </div>

              {testResult && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="text-xs font-medium mb-1 flex items-center gap-1">
                    <ArrowUpFromLine className="h-3 w-3" /> Response
                  </div>
                  <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all max-h-[280px] overflow-auto">
                    {testResult.ok
                      ? JSON.stringify(testResult.data, null, 2)
                      : testResult.error}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PayloadRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const isOk =
    row.result === "ok" ||
    row.result === "success" ||
    row.result === "accepted";
  const md = row.metadata ?? {};
  const requestBody = md.request ?? md.req ?? md.payload ?? null;
  const responseBody = md.response ?? md.res ?? md.result_body ?? null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge
                variant={isOk ? "default" : "destructive"}
                className={
                  isOk
                    ? "bg-emerald-600 hover:bg-emerald-600 text-[10px]"
                    : "text-[10px]"
                }
              >
                {row.result}
              </Badge>
              <span className="text-sm font-medium truncate">{row.action}</span>
              {row.tenant_name && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {row.tenant_name}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
              <span>{new Date(row.created_at).toLocaleString()}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2">
            <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5">
              <div>
                <span className="font-medium">tenant:</span>{" "}
                {row.tenant_name ? (
                  <>
                    <span>{row.tenant_name}</span>{" "}
                    <code className="opacity-60">({row.tenant_id.slice(0, 8)})</code>
                  </>
                ) : (
                  <code>{row.tenant_id}</code>
                )}
              </div>
              <div>
                <span className="font-medium">request_id:</span>{" "}
                <code>{row.request_id ?? "—"}</code>
              </div>
            </div>

            {requestBody !== null && (
              <PayloadBlock
                label="Request sent"
                icon={<ArrowUpFromLine className="h-3 w-3" />}
                body={requestBody}
              />
            )}
            {responseBody !== null && (
              <PayloadBlock
                label="Response received"
                icon={<ArrowDownToLine className="h-3 w-3" />}
                body={responseBody}
              />
            )}
            {requestBody === null && responseBody === null && (
              <PayloadBlock label="Metadata" icon={null} body={md} />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function PayloadBlock({
  label,
  icon,
  body,
}: {
  label: string;
  icon: React.ReactNode;
  body: unknown;
}) {
  return (
    <div className="rounded bg-muted/40 border p-2">
      <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground flex items-center gap-1 mb-1">
        {icon}
        {label}
      </div>
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all max-h-[220px] overflow-auto">
        {typeof body === "string" ? body : JSON.stringify(body, null, 2)}
      </pre>
    </div>
  );
}
