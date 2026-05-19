import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const URL = "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/roofhub-webhook";
const KEY = Deno.env.get("ROOFHUB_INTEGRATION_KEY")!;

Deno.test("roofhub-webhook responds 200 for unmatched order with valid key", async () => {
  const body = {
    eventId: "selftest-" + Date.now(),
    eventType: "OU",
    eventStatus: "confirmed",
    eventDateTime: new Date().toISOString(),
    subscriberReferenceNum: "job:does-not-exist-xyz",
    subscriberReferenceNum2: "SO-DOES-NOT-EXIST",
    subscriberReferenceNum3: "TX-DOES-NOT-EXIST",
  };

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Integration-Key": KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("status:", res.status);
  console.log("body:", text);
  assertEquals(res.status, 200);
  const json = JSON.parse(text);
  assertEquals(json.ok, true);
  assertEquals(json.matched, false);
});
