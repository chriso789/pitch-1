// Generates a short professional caption for a single job-site photo using
// the Lovable AI Gateway (google/gemini-2.5-flash vision). Returns { caption }.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ ok: false, error: "LOVABLE_API_KEY missing" }, 500);

    const body = await req.json().catch(() => ({}));
    const image_url: string | undefined = body?.image_url;
    const category: string | undefined = body?.category;
    const address: string | undefined = body?.address;
    if (!image_url) return json({ ok: false, error: "image_url required" }, 400);

    const contextParts: string[] = [];
    if (category) contextParts.push(`Category: ${category}`);
    if (address) contextParts.push(`Property: ${address}`);
    const contextLine = contextParts.length ? `\n${contextParts.join(" · ")}` : "";

    const sys =
      "You are a roofing/construction inspector writing concise photo captions " +
      "for a client-facing report. One sentence, 12-22 words, factual, no fluff, " +
      "no marketing language, no emojis. Describe what is visibly shown " +
      "(component, condition, damage, materials, location on structure).";

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Write a single-sentence caption for this job-site photo.${contextLine}`,
              },
              { type: "image_url", image_url: { url: image_url } },
            ],
          },
        ],
      }),
    });

    if (aiRes.status === 429) return json({ ok: false, error: "rate_limited" }, 429);
    if (aiRes.status === 402) return json({ ok: false, error: "credits_required" }, 402);
    if (!aiRes.ok) {
      const t = await aiRes.text();
      return json({ ok: false, error: `ai_gateway_${aiRes.status}: ${t.slice(0, 300)}` }, 500);
    }
    const j = await aiRes.json();
    let caption = String(j?.choices?.[0]?.message?.content ?? "").trim();
    caption = caption.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 240);
    return json({ ok: true, caption });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
