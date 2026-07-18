import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSegments } from "../segment-parser.ts";

Deno.test("parseSegments salvages Fonsica trace objects from truncated markdown JSON", () => {
  const raw = `\`\`\`json
{
  "segments": [
    {
      "type": "eave",
      "points": [[195, 435], [440, 435]],
      "confidence": 0.95
    },
    {
      "type": "hip",
      "points": [[440, 435], [330, 225]],
      "confidence": 0.9
    },

[ai_trace_rejected_off_target_no_template_fallback]`;

  const segments = parseSegments(raw);

  assertEquals(segments.length, 2);
  assertEquals(segments[0].type, "eave");
  assertEquals(segments[0].points, [[195, 435], [440, 435]]);
  assertEquals(segments[1].type, "hip");
});

Deno.test("parseSegments reads complete strict JSON normally", () => {
  const segments = parseSegments(JSON.stringify({
    segments: [
      { type: "ridge", points: [[210, 240], [375, 240]], confidence: 0.91 },
    ],
  }));

  assertEquals(segments, [{ type: "ridge", points: [[210, 240], [375, 240]], confidence: 0.91 }]);
});