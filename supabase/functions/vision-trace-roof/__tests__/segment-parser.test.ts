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

Deno.test("parseSegments reads compact trace JSON to avoid model truncation", () => {
  const segments = parseSegments('{"s":[["e",190,440,435,440,0.95],["h",435,440,330,225,0.9],["v",250,260,315,330,0.82]]}');

  assertEquals(segments, [
    { type: "eave", points: [[190, 440], [435, 440]], confidence: 0.95 },
    { type: "hip", points: [[435, 440], [330, 225]], confidence: 0.9 },
    { type: "valley", points: [[250, 260], [315, 330]], confidence: 0.82 },
  ]);
});

Deno.test("parseSegments salvages compact arrays from truncated Fonsica response", () => {
  const raw = '{"s":[["e",300,466,469,466,0.95],["e",469,466,469,320,0.92],["e",300,466,300,300,0.93],["h",300,466,370,380,0.9],["h",469,466,400,380,0.9],["r",370,380,400,380,0.92],\n[ai_trace_rejected_off_target_no_template_fallback]';

  const segments = parseSegments(raw);

  assertEquals(segments.length, 6);
  assertEquals(segments[5], { type: "ridge", points: [[370, 380], [400, 380]], confidence: 0.92 });
});