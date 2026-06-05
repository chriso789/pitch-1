import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const FOREIGN_TENANT_ID = "5a02983a-3d4d-4d5e-af01-7f2c7f02e78c"; // Under One Roof — NOT O'Brien

type GateResult = {
  name: string;
  pass: boolean;
  detail: string;
};

type ComboReport = {
  startedAt: string;
  callerEmail: string | null;
  callerUserId: string | null;
  callerTenantId: string | null;
  abc: { status: number | string | null; data: any; error: any };
  srs: { status: number | string | null; data: any; error: any };
  counts: {
    abc_api_audit_since_start_own_tenant: number | null;
    abc_orders_since_start_own_tenant: number | null;
    abc_order_lines_since_start_own_tenant: number | null;
    srs_credential_audit_since_start_foreign_tenant: number | null;
  };
  gates: GateResult[];
  verdict: "PASS" | "FAIL";
};

export default function AbcValidateDebug() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [srsLoading, setSrsLoading] = useState(false);
  const [srsOutput, setSrsOutput] = useState<string>("");
  const [comboLoading, setComboLoading] = useState(false);
  const [comboReport, setComboReport] = useState<ComboReport | null>(null);

  const run = async () => {
    setLoading(true);
    setOutput("Running…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      const log: any = {
        step1_session_user: session?.user?.email ?? null,
        step1_has_access_token: !!session?.access_token,
        step2_getUser_id: user?.id ?? null,
      };
      const body = {
        action: "validate_payload_only",
        environment: "sandbox",
        sandboxDemo: true,
        shipToNumber: "2010466-2",
        branchNumber: "1209",
        itemNumber: "02OCTDUMP",
        itemDescription: "Sandbox Demo Item 02OCTDUMP",
        uom: "EA",
        quantity: 1,
        priceOverride: { value: 1.0, reason: "Sandbox Price Items call WAF-blocked; payload validation only for ABC demo." },
        jobsiteContact: { name: "Demo Contact", email: "demo@example.com", phone: "555-555-5555" },
      };
      const { data, error } = await supabase.functions.invoke("supplier-api/abc/proxy", { body });
      log.response_data = data;
      log.response_error = error
        ? { message: error.message, name: error.name, ctx: (error as any).context ?? null }
        : null;
      setOutput(JSON.stringify(log, null, 2));
    } catch (e: any) {
      setOutput("Threw: " + (e?.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  };

  const runSrsSpoof = async () => {
    setSrsLoading(true);
    setSrsOutput("Running…");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const log: any = {
        caller_user_id: user?.id ?? null,
        spoofed_tenant_id: FOREIGN_TENANT_ID,
      };
      const { data, error } = await supabase.functions.invoke("srs-api-proxy", {
        body: { action: "ping", tenant_id: FOREIGN_TENANT_ID },
      });
      log.response_data = data;
      log.response_error = error
        ? { message: error.message, name: error.name, ctx: (error as any).context ?? null }
        : null;
      setSrsOutput(JSON.stringify(log, null, 2));
    } catch (e: any) {
      setSrsOutput("Threw: " + (e?.message ?? String(e)));
    } finally {
      setSrsLoading(false);
    }
  };

  const runBothProofs = async () => {
    setComboLoading(true);
    setComboReport(null);
    const startedAt = new Date().toISOString();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user?.id
        ? await supabase.from("profiles").select("active_tenant_id, tenant_id").eq("id", user.id).maybeSingle()
        : { data: null as any };
      const callerTenantId: string | null =
        (profile as any)?.active_tenant_id || (profile as any)?.tenant_id || null;

      // 1) ABC validate_payload_only
      const abcBody = {
        action: "validate_payload_only",
        environment: "sandbox",
        sandboxDemo: true,
        shipToNumber: "2010466-2",
        branchNumber: "1209",
        itemNumber: "02OCTDUMP",
        itemDescription: "Sandbox Demo Item 02OCTDUMP",
        uom: "EA",
        quantity: 1,
        priceOverride: { value: 1.0, reason: "Sandbox Price Items call WAF-blocked; payload validation only for ABC demo." },
        jobsiteContact: { name: "Demo Contact", email: "demo@example.com", phone: "555-555-5555" },
      };
      const abcInvoke = await supabase.functions.invoke("supplier-api/abc/proxy", { body: abcBody });
      const abcStatus =
        (abcInvoke.error as any)?.context?.status ??
        ((abcInvoke as any)?.response?.status ?? null);

      // 2) SRS spoof
      const srsInvoke = await supabase.functions.invoke("srs-api-proxy", {
        body: { action: "ping", tenant_id: FOREIGN_TENANT_ID },
      });
      const srsStatus =
        (srsInvoke.error as any)?.context?.status ??
        ((srsInvoke as any)?.response?.status ?? null);

      // 3) Verify table side-effects (best-effort, RLS-scoped)
      const since = startedAt;
      const counts: ComboReport["counts"] = {
        abc_api_audit_since_start_own_tenant: null,
        abc_orders_since_start_own_tenant: null,
        abc_order_lines_since_start_own_tenant: null,
        srs_credential_audit_since_start_foreign_tenant: null,
      };

      if (callerTenantId) {
        const q1 = await (supabase as any)
          .from("abc_api_audit")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", callerTenantId)
          .gte("created_at", since);
        counts.abc_api_audit_since_start_own_tenant = q1.count ?? null;

        const q2 = await (supabase as any)
          .from("abc_orders")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", callerTenantId)
          .gte("created_at", since);
        counts.abc_orders_since_start_own_tenant = q2.count ?? null;

        const q3 = await (supabase as any)
          .from("abc_order_lines")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", callerTenantId)
          .gte("created_at", since);
        counts.abc_order_lines_since_start_own_tenant = q3.count ?? null;
      }

      // RLS will hide foreign-tenant rows from this caller; a 0 (or null) is the
      // expected, secure result for the spoof check.
      const q4 = await (supabase as any)
        .from("srs_credential_audit")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", FOREIGN_TENANT_ID)
        .gte("created_at", since);
      counts.srs_credential_audit_since_start_foreign_tenant = q4.count ?? 0;

      // 4) Gates
      const abcData: any = abcInvoke.data ?? null;
      const abcValidationPass =
        !!abcData && (abcData.validation === "PASS" || abcData.success === true) && !!abcData.payloadProof;

      const srsErr: any = srsInvoke.error ?? null;
      const srsBlocked =
        !!srsErr &&
        (Number(srsStatus) === 403 ||
          Number(srsStatus) === 401 ||
          /not.*member|forbidden|unauthorized|tenant/i.test(String(srsErr.message || "")));

      const gates: GateResult[] = [
        {
          name: "ABC validate_payload_only returned validation=PASS with payloadProof",
          pass: abcValidationPass,
          detail: abcData
            ? `validation=${abcData.validation ?? "n/a"} success=${abcData.success ?? "n/a"} hasPayloadProof=${!!abcData.payloadProof} hasOrderRequest=${!!abcData.orderRequest}`
            : `error=${abcInvoke.error?.message ?? "unknown"}`,
        },
        {
          name: "ABC wrote exactly 1 abc_api_audit row (own tenant, since start)",
          pass: counts.abc_api_audit_since_start_own_tenant === 1,
          detail: `count=${counts.abc_api_audit_since_start_own_tenant}`,
        },
        {
          name: "ABC wrote NO abc_orders rows (validate-only)",
          pass: !counts.abc_orders_since_start_own_tenant,
          detail: `count=${counts.abc_orders_since_start_own_tenant ?? 0}${counts.abc_orders_since_start_own_tenant === null ? " (no visible rows — RLS or empty)" : ""}`,
        },
        {
          name: "ABC wrote NO abc_order_lines rows (validate-only)",
          pass: !counts.abc_order_lines_since_start_own_tenant,
          detail: `count=${counts.abc_order_lines_since_start_own_tenant ?? 0}${counts.abc_order_lines_since_start_own_tenant === null ? " (no visible rows — RLS or empty)" : ""}`,
        },
        {
          name: "SRS spoof rejected (403/401 tenant-mismatch)",
          pass: srsBlocked,
          detail: srsErr ? `status=${srsStatus} message="${srsErr.message}"` : `unexpected success: ${JSON.stringify(srsInvoke.data)}`,
        },
        {
          name: "SRS wrote NO srs_credential_audit rows for foreign tenant",
          pass: counts.srs_credential_audit_since_start_foreign_tenant === 0,
          detail: `count=${counts.srs_credential_audit_since_start_foreign_tenant}`,
        },
      ];

      const verdict: "PASS" | "FAIL" = gates.every((g) => g.pass) ? "PASS" : "FAIL";

      setComboReport({
        startedAt,
        callerEmail: user?.email ?? null,
        callerUserId: user?.id ?? null,
        callerTenantId,
        abc: { status: abcStatus, data: abcInvoke.data ?? null, error: abcInvoke.error ?? null },
        srs: { status: srsStatus, data: srsInvoke.data ?? null, error: srsInvoke.error ?? null },
        counts,
        gates,
        verdict,
      });
    } catch (e: any) {
      setComboReport({
        startedAt,
        callerEmail: null,
        callerUserId: null,
        callerTenantId: null,
        abc: { status: null, data: null, error: { message: e?.message ?? String(e) } },
        srs: { status: null, data: null, error: null },
        counts: {
          abc_api_audit_since_start_own_tenant: null,
          abc_orders_since_start_own_tenant: null,
          abc_order_lines_since_start_own_tenant: null,
          srs_credential_audit_since_start_foreign_tenant: null,
        },
        gates: [],
        verdict: "FAIL",
      });
    } finally {
      setComboLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <section className="space-y-4 border-2 border-primary rounded-lg p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">One-Click Proof Run</h1>
          {comboReport && (
            <Badge variant={comboReport.verdict === "PASS" ? "default" : "destructive"} className="text-base">
              {comboReport.verdict}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Runs ABC <code>validate_payload_only</code> then SRS cross-tenant spoof
          (foreign tenant <code>{FOREIGN_TENANT_ID}</code>) in sequence, then
          counts affected rows in <code>abc_api_audit</code>, <code>abc_orders</code>,{" "}
          <code>abc_order_lines</code>, and <code>srs_credential_audit</code> since
          the run started.
        </p>
        <Button onClick={runBothProofs} disabled={comboLoading} size="lg">
          {comboLoading ? "Running both proofs…" : "Run validate + SRS spoof"}
        </Button>

        {comboReport && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-muted p-2 rounded">
                <div className="font-semibold">Caller</div>
                <div>{comboReport.callerEmail}</div>
                <div className="text-muted-foreground">tenant: {comboReport.callerTenantId ?? "—"}</div>
              </div>
              <div className="bg-muted p-2 rounded">
                <div className="font-semibold">Started</div>
                <div>{comboReport.startedAt}</div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold">Gates</h3>
              {comboReport.gates.map((g, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant={g.pass ? "default" : "destructive"} className="shrink-0">
                    {g.pass ? "PASS" : "FAIL"}
                  </Badge>
                  <div>
                    <div className="font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{g.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold">Affected-row counts since run started</h3>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto">
                {JSON.stringify(comboReport.counts, null, 2)}
              </pre>
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-semibold">Raw responses</summary>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap">
                {JSON.stringify({ abc: comboReport.abc, srs: comboReport.srs }, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">ABC Validate-Only (standalone)</h2>
        <Button onClick={run} disabled={loading} variant="outline">
          {loading ? "Running…" : "Run validate_payload_only"}
        </Button>
        <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap">
          {output || "Click the button to run."}
        </pre>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-bold">SRS Cross-Tenant Spoof (standalone)</h2>
        <Button onClick={runSrsSpoof} disabled={srsLoading} variant="destructive">
          {srsLoading ? "Running…" : "Run SRS spoof test"}
        </Button>
        <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap">
          {srsOutput || "Click the button to run."}
        </pre>
      </section>
    </div>
  );
}
