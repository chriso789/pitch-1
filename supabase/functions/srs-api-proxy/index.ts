import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SRS_STAGING_URL = "https://services-qa.roofhub.pro";
const SRS_PRODUCTION_URL = "https://services.roofhub.pro";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action, tenant_id, ...params } = body;

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load SRS connection for this tenant
    const { data: connection, error: connErr } = await supabase
      .from("srs_connections")
      .select("*")
      .eq("tenant_id", tenant_id)
      .single();

    if (connErr || !connection) {
      return new Response(
        JSON.stringify({ error: "SRS connection not configured" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = connection.environment === "production" ? SRS_PRODUCTION_URL : SRS_STAGING_URL;

    // Helper to get valid access token
    async function getAccessToken(): Promise<string> {
      // Check if existing token is still valid (with 5 min buffer)
      if (connection.access_token && connection.token_expires_at) {
        const expiresAt = new Date(connection.token_expires_at);
        if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
          return connection.access_token;
        }
      }

      // Request new token
      const tokenResp = await fetch(`${baseUrl}/authentication/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: connection.client_id,
          client_secret: connection.client_secret,
          grant_type: "client_credentials",
          scope: "ALL",
        }),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        throw new Error(`Auth failed [${tokenResp.status}]: ${errText}`);
      }

      const tokenData = await tokenResp.json();
      const newToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in || 86400;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Save token
      await supabase
        .from("srs_connections")
        .update({ access_token: newToken, token_expires_at: expiresAt })
        .eq("id", connection.id);

      return newToken;
    }

    // Helper for authenticated API calls
    async function srsApiCall(path: string, method = "GET", reqBody?: any): Promise<any> {
      const token = await getAccessToken();
      const opts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      };
      if (reqBody) opts.body = JSON.stringify(reqBody);

      const resp = await fetch(`${baseUrl}${path}`, opts);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`SRS API error [${resp.status}]: ${errText}`);
      }
      return resp.json();
    }

    let result: any;

    switch (action) {
      case "validate_connection": {
        try {
          await getAccessToken();

          // Validate customer
          const validateData = await srsApiCall(
            `/api/customer/validate?customerCode=${connection.customer_code}`
          );

          const isValid = validateData?.validIndicator === true;

          // If valid, get customer branch locations for job account number
          let jobAccountNumber = null;
          let defaultBranch = null;

          if (isValid && connection.customer_code) {
            try {
              const branchData = await srsApiCall(
                `/branches/v2/customerBranchLocations/${connection.customer_code}`
              );
              if (branchData && Array.isArray(branchData) && branchData.length > 0) {
                jobAccountNumber = branchData[0].jobAccountNumber;
                defaultBranch = branchData[0].branchCode;
              } else if (branchData?.jobAccountNumber) {
                jobAccountNumber = branchData.jobAccountNumber;
                defaultBranch = branchData.branchCode;
              }
            } catch (e) {
              console.warn("Could not fetch branch locations:", e);
            }
          }

          // Update connection status
          await supabase
            .from("srs_connections")
            .update({
              connection_status: isValid ? "connected" : "error",
              valid_indicator: isValid,
              last_validated_at: new Date().toISOString(),
              last_error: isValid ? null : "Customer validation failed",
              job_account_number: jobAccountNumber,
              default_branch_code: defaultBranch,
            })
            .eq("id", connection.id);

          result = {
            success: isValid,
            jobAccountNumber,
            defaultBranch,
          };
        } catch (err: any) {
          await supabase
            .from("srs_connections")
            .update({
              connection_status: "error",
              last_error: err instanceof Error ? err.message : String(err),
              last_validated_at: new Date().toISOString(),
            })
            .eq("id", connection.id);

          result = { success: false, error: err instanceof Error ? err.message : String(err) };
        }
        break;
      }

      case "sync_branches": {
        const branchData = await srsApiCall("/branches/v2/branchLocations");
        const branches = Array.isArray(branchData) ? branchData : branchData?.branchLocations || [];

        // Upsert branches
        for (const branch of branches) {
          await supabase.from("srs_branches").upsert(
            {
              tenant_id,
              branch_code: branch.branchCode || branch.code,
              branch_name: branch.branchName || branch.name,
              address: branch.address || branch.streetAddress,
              city: branch.city,
              state: branch.state,
              zip: branch.zip || branch.postalCode,
              phone: branch.phone,
              shipping_methods: branch.shippingMethods || [],
              cached_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,branch_code" }
          );
        }

        result = { success: true, branchCount: branches.length };
        break;
      }

      case "get_branches": {
        const { data: branches } = await supabase
          .from("srs_branches")
          .select("*")
          .eq("tenant_id", tenant_id)
          .order("branch_name");

        result = { branches: branches || [] };
        break;
      }

      case "get_products": {
        const { branch_code } = params;
        if (!branch_code) throw new Error("branch_code required");

        const products = await srsApiCall(
          `/branches/v2/activeBranchProducts/${branch_code}`
        );

        result = { products: Array.isArray(products) ? products : products?.products || [] };
        break;
      }

      case "get_pricing": {
        const { branch_code, product_list } = params;
        if (!branch_code || !product_list) throw new Error("branch_code and product_list required");

        const pricing = await srsApiCall("/products/v2/price", "POST", {
          customerCode: connection.customer_code,
          branchCode: branch_code,
          productList: product_list,
        });

        result = { pricing };
        break;
      }

      case "submit_order": {
        const { order_id } = params;
        if (!order_id) throw new Error("order_id required");

        // Load order with items
        const { data: order } = await supabase
          .from("srs_orders")
          .select("*, srs_order_items(*)")
          .eq("id", order_id)
          .single();

        if (!order) throw new Error("Order not found");

        // Build SRS order payload
        const orderPayload = {
          customerCode: connection.customer_code,
          branchCode: order.branch_code,
          jobAccountNumber: connection.job_account_number,
          deliveryMethod: order.delivery_method || "delivery",
          requestedDeliveryDate: order.delivery_date,
          poNumber: order.order_number,
          notes: order.notes,
          orderItems: order.srs_order_items.map((item: any) => ({
            productId: item.srs_product_id,
            quantity: item.quantity,
            uom: item.uom,
          })),
        };

        const orderResult = await srsApiCall("/orders/v2/submit", "POST", orderPayload);

        // Update order with SRS response
        await supabase
          .from("srs_orders")
          .update({
            srs_order_id: orderResult.orderID,
            srs_transaction_id: orderResult.transactionID,
            status: "submitted",
            submitted_at: new Date().toISOString(),
            srs_response: orderResult,
          })
          .eq("id", order_id);

        // Log status change
        await supabase.from("srs_order_status_history").insert({
          order_id,
          old_status: "draft",
          new_status: "submitted",
          status_message: `Order submitted. SRS Order ID: ${orderResult.orderID}`,
        });

        result = { success: true, srsOrderId: orderResult.orderID };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("SRS API Proxy error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
