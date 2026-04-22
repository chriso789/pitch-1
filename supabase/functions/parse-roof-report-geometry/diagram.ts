// AI vision pass that extracts diagram geometry from a vendor report image.

const DIAGRAM_PROMPT = `Analyze this roof diagram from a professional measurement report.

Return STRICT JSON with this shape:
{
  "footprint_polygon": [[x,y], ...],
  "facets": [{"id":1,"polygon":[{"x":0,"y":0}, ...],"orientation":"N|S|E|W"}],
  "edges": {
    "ridges": [{"start":{"x":0,"y":0},"end":{"x":0,"y":0}}],
    "hips": [], "valleys": [], "eaves": [], "rakes": []
  },
  "hasCompass": false,
  "diagramType": "schematic|satellite-overlay"
}

Coordinates: pixels, top-left origin, X right, Y down. Polygon points clockwise.`;

export async function analyzeReportDiagram(imageBase64: string): Promise<unknown | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: DIAGRAM_PROMPT },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
      max_completion_tokens: 2000,
    }),
  });

  if (!res.ok) {
    console.error("AI diagram analysis failed:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
