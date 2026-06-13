/**
 * QXO legacy shim forwarding — integration test scaffold.
 *
 * Verifies each legacy QXO function is now a forwarder to qxo-api and
 * never loads QXO credentials itself.
 *
 * Files under test:
 *   - supabase/functions/qxo-orders/index.ts            → qxo-api /orders/{list,detail,pdf}
 *   - supabase/functions/qxo-invoices-v4/index.ts       → qxo-api /invoices/{list,pdf}
 *   - supabase/functions/qxo-quotes/index.ts            → qxo-api /quotes/{detail,list,revise,reject,submit}
 *   - supabase/functions/qxo-submit-order/index.ts      → qxo-api /orders/submit
 *   - supabase/functions/qxo-submit-quote-order/index.ts→ qxo-api /orders/submit-quote
 *   - supabase/functions/qxo-push-order/index.ts        → qxo-api /orders/submit
 *   - supabase/functions/qxo-pricing/index.ts           → qxo-api /pricing/lookup
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHIMS = [
  "qxo-orders",
  "qxo-invoices-v4",
  "qxo-quotes",
  "qxo-submit-order",
  "qxo-submit-quote-order",
  "qxo-push-order",
  "qxo-pricing",
];

describe("qxo legacy shims", () => {
  for (const shim of SHIMS) {
    describe(shim, () => {
      const source = readFileSync(
        resolve(process.cwd(), `supabase/functions/${shim}/index.ts`),
        "utf-8",
      );

      it("carries the TEMPORARY SHIM marker comment", () => {
        expect(source).toContain("TEMPORARY SHIM");
      });

      it("forwards to qxo-api", () => {
        expect(source).toMatch(/qxo-api/);
      });

      it("does NOT import qxo-auth (never loads QXO credentials directly)", () => {
        expect(source).not.toMatch(/from\s+["']\.\.\/_shared\/qxo-auth/);
        expect(source).not.toMatch(/getBeaconAuth/);
        expect(source).not.toMatch(/loadConnectionWithCredentials/);
      });

      it("does NOT read body.tenant_id", () => {
        // Shim should never parse out tenant_id — it only forwards.
        expect(source).not.toMatch(/body\.tenant_id|body\["tenant_id"\]/);
      });

      it("does NOT use the service role key", () => {
        expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      });
    });

    it.todo(`${shim} forwards Authorization header verbatim`);
    it.todo(`${shim} sets x-shim-from header`);
    it.todo(`${shim} does not return any token/credential substrings`);
  }
});
