import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// 1x1 transparent GIF
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

function pixelResponse() {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t");
    if (!token) return pixelResponse();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: link } = await supabase
      .from("quote_tracking_links")
      .select(
        `id, tenant_id, sent_by, estimate_id, contact_id, recipient_name, email_opened_at,
         enhanced_estimates ( estimate_number ),
         contacts ( first_name, last_name )`
      )
      .eq("token", token)
      .maybeSingle();

    if (!link) return pixelResponse();

    // Only notify on the first open of this email
    const alreadyOpened = !!link.email_opened_at;

    const { data: current } = await supabase
      .from("quote_tracking_links")
      .select("email_open_count")
      .eq("id", link.id)
      .maybeSingle();

    await supabase
      .from("quote_tracking_links")
      .update({
        email_opened_at: link.email_opened_at || new Date().toISOString(),
        email_open_count: (current?.email_open_count || 0) + 1,
      })
      .eq("id", link.id);

    if (alreadyOpened) return pixelResponse();

    const contactName = link.contacts
      ? `${link.contacts.first_name ?? ""} ${link.contacts.last_name ?? ""}`.trim()
      : link.recipient_name || "A customer";
    const estimateNum = link.enhanced_estimates?.estimate_number || "your quote";

    await supabase.from("user_notifications").insert({
      tenant_id: link.tenant_id,
      user_id: link.sent_by,
      title: "Email Opened 📬",
      message: `${contactName} opened your quote email #${estimateNum}`,
      type: "quote_email_opened",
      priority: "high",
      metadata: {
        tracking_link_id: link.id,
        estimate_id: link.estimate_id,
        contact_id: link.contact_id,
      },
    });

    // SMS the rep
    try {
      const { data: repProfile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", link.sent_by)
        .maybeSingle();

      let phone = repProfile?.phone as string | null | undefined;
      if (!phone) {
        const { data: authUser } = await supabase.auth.admin.getUserById(link.sent_by);
        phone = authUser?.user?.phone || (authUser?.user?.user_metadata?.phone as string | undefined);
      }

      if (phone) {
        await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: phone,
            message: `📬 ${contactName} just opened your quote email #${estimateNum}`,
            tenant_id: link.tenant_id,
            sent_by: link.sent_by,
          }),
        });
      } else {
        console.log("[track-quote-open] rep has no phone on file, SMS skipped", link.sent_by);
      }
    } catch (smsErr) {
      console.error("[track-quote-open] SMS error", smsErr);
    }

    return pixelResponse();
  } catch (err) {
    console.error("[track-quote-open] error", err);
    return pixelResponse();
  }
});
