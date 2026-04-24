import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload = await req.json();

    console.log("SRS Webhook received:", JSON.stringify(payload));

    const { orderID, transactionID, status, message } = payload;

    if (!orderID && !transactionID) {
      return new Response(JSON.stringify({ error: "Missing order identifier" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the order
    let query = supabase.from("srs_orders").select("*");
    if (orderID) query = query.eq("srs_order_id", orderID);
    else if (transactionID) query = query.eq("srs_transaction_id", transactionID);

    const { data: order, error: orderErr } = await query.single();

    if (orderErr || !order) {
      console.warn("Order not found for webhook:", { orderID, transactionID });
      return new Response(JSON.stringify({ received: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map SRS status to internal status
    const statusMap: Record<string, string> = {
      confirmed: "confirmed",
      processing: "processing",
      shipped: "shipped",
      delivered: "delivered",
      cancelled: "cancelled",
    };

    const newStatus = statusMap[status?.toLowerCase()] || order.status;
    const oldStatus = order.status;

    // Update order
    await supabase
      .from("srs_orders")
      .update({ status: newStatus })
      .eq("id", order.id);

    // Log status change
    await supabase.from("srs_order_status_history").insert({
      order_id: order.id,
      old_status: oldStatus,
      new_status: newStatus,
      status_message: message || `Status updated to ${newStatus}`,
      raw_webhook_data: payload,
    });

    return new Response(JSON.stringify({ received: true, matched: true, newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("SRS Webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
