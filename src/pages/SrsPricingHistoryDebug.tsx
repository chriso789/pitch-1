import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function SrsPricingHistoryDebug() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string>("");

  const run = async () => {
    setLoading(true);
    setOutput("Running…");
    const log: any = {};
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      log.step1_session_user = session?.user?.email ?? null;
      log.step1_session_sub = session?.user?.id ?? null;
      log.step1_has_access_token = !!session?.access_token;
      log.step2_getUser_email = user?.email ?? null;
      log.step2_getUser_id = user?.id ?? null;

      if (user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, tenant_id, first_name, last_name, email")
          .eq("id", user.id)
          .maybeSingle();
        log.step3_profile = profile;
      }

      // ---- load SRS connection summary (client-side, RLS-scoped) ----
      const { data: conn, error: connErr } = await supabase
        .from("srs_connections")
        .select(
          "id, tenant_id, customer_code, default_branch_code, job_account_number, environment, connection_status"
        )
        .maybeSingle();
      log.step4_srs_connection = conn;
      log.step4_srs_connection_error = connErr?.message ?? null;
      if (!conn) throw new Error("No SRS connection visible for this tenant");

      const branchCode = String(conn.default_branch_code || "").trim();
      if (!branchCode) throw new Error("Connection has no default_branch_code");

      // ---- fetch activeBranchProducts via srs-api-proxy ----
      const { data: prodResp, error: prodErr } = await supabase.functions.invoke(
        "srs-api-proxy",
        { body: { action: "get_products", params: { branch_code: branchCode } } }
      );
      log.step5_get_products_error = prodErr
        ? { message: prodErr.message, ctx: (prodErr as any).context ?? null }
        : null;
      const productsArr: any[] = Array.isArray(prodResp?.products)
        ? prodResp.products
        : Array.isArray(prodResp?.data?.products)
        ? prodResp.data.products
        : [];
      log.step5_products_count = productsArr.length;

      const firstValid = productsArr.find((p: any) => {
        const pid = Number(p?.productId);
        return Number.isFinite(pid) && pid > 0;
      });
      log.step5_first_valid_product = firstValid
        ? {
            productId: firstValid.productId,
            productNumber: firstValid.productNumber ?? null,
            productName: firstValid.productName ?? firstValid.description ?? null,
            uom: firstValid.uom ?? null,
          }
        : null;
      if (!firstValid) {
        throw new Error("activeBranchProducts returned no valid productId");
      }

      // ---- snapshot BEFORE: estimate_line_items unchanged? srs_orders count? ----
      const { count: ordersBefore } = await supabase
        .from("srs_orders")
        .select("id", { count: "exact", head: true });
      log.step6_srs_orders_count_before = ordersBefore ?? 0;

      const { data: liSample } = await supabase
        .from("estimate_line_items")
        .select("id, unit_cost, cost")
        .order("created_at", { ascending: false })
        .limit(3);
      log.step6_estimate_line_items_sample_before = liSample;

      // ---- call /pricing/record-history ----
      const body = {
        source_context: "template",
        source_id: null,
        environment: conn.environment || "staging",
        branch_code: branchCode,
        items: [
          {
            template_item_id: null,
            estimate_line_item_id: null,
            productId: Number(firstValid.productId),
            productNumber:
              firstValid.productNumber ?? String(firstValid.productId),
            productName:
              firstValid.productName ?? firstValid.description ?? null,
            productDescription:
              firstValid.productDescription ?? firstValid.description ?? null,
            uom: String(firstValid.uom || "EA").toUpperCase(),
            quantity: 1,
          },
        ],
      };
      log.step7_request_body = body;

      const { data: priceResp, error: priceErr } = await supabase.functions.invoke(
        "srs-api/pricing/record-history",
        { body }
      );
      log.step7_response_data = priceResp;
      log.step7_response_error = priceErr
        ? { message: priceErr.message, ctx: (priceErr as any).context ?? null }
        : null;

      const runId =
        priceResp?.run_id ?? priceResp?.data?.run_id ?? priceResp?.runId ?? null;
      log.step8_run_id = runId;

      // ---- read pricing_run + history rows ----
      if (runId) {
        const { data: runRow } = await supabase
          .from("supplier_pricing_runs")
          .select("*")
          .eq("id", runId)
          .maybeSingle();
        log.step8_pricing_run_row = runRow;

        const { data: histRows } = await supabase
          .from("supplier_price_history")
          .select("*")
          .eq("pricing_run_id", runId)
          .order("checked_at", { ascending: true });
        log.step8_price_history_rows = histRows;
      }

      // ---- snapshot AFTER ----
      const { count: ordersAfter } = await supabase
        .from("srs_orders")
        .select("id", { count: "exact", head: true });
      log.step9_srs_orders_count_after = ordersAfter ?? 0;
      log.step9_srs_orders_unchanged = ordersBefore === ordersAfter;

      const { data: liSampleAfter } = await supabase
        .from("estimate_line_items")
        .select("id, unit_cost, cost")
        .in("id", (liSample ?? []).map((r: any) => r.id));
      log.step9_estimate_line_items_sample_after = liSampleAfter;
      log.step9_estimate_costs_unchanged =
        JSON.stringify(liSample ?? []) === JSON.stringify(liSampleAfter ?? []);

      log.step10_error_summary =
        priceResp?.error_summary ?? priceResp?.data?.error_summary ?? null;
      log.timestamp = new Date().toISOString();

      setOutput(JSON.stringify(log, null, 2));
      console.log("[SRS pricing-history debug]", log);
    } catch (e: any) {
      log.threw = e?.message ?? String(e);
      setOutput(JSON.stringify(log, null, 2));
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">SRS Pricing-History Debug</h1>
      <p className="text-sm text-muted-foreground">
        Pulls a real productId from activeBranchProducts for the O'Brien default
        branch, then calls <code>srs-api /pricing/record-history</code> with a
        single item. Asserts no order is submitted and estimate costs are not
        changed.
      </p>
      <Button onClick={run} disabled={loading}>
        {loading ? "Running…" : "Run SRS pricing-history test"}
      </Button>
      <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[70vh] whitespace-pre-wrap">
        {output || "Click the button to run."}
      </pre>
    </div>
  );
}
