/**
 * QXO order idempotency — integration test scaffold.
 *
 * Enforced today by:
 *   - supabase/functions/_shared/integrations/qxo-idempotency.ts
 *   - supabase/functions/qxo-api/index.ts (/orders/submit, /orders/submit-quote,
 *     /quotes/revise, /quotes/submit all use withIdempotency)
 *   - supplier_idempotency_keys UNIQUE (tenant_id, supplier, action, key)
 */
import { describe, it } from "vitest";

describe("qxo-api order idempotency", () => {
  it.todo("Missing idempotency key on /orders/submit returns 400 idempotency_key_required");
  it.todo("Header Idempotency-Key is accepted in addition to body.idempotency_key");
  it.todo("Same key + same payload returns the stored response (replayed=true)");
  it.todo("Same key + same payload calls Beacon submitOrder exactly once");
  it.todo("Same key + different payload returns 409 idempotency_key_reused_with_different_payload");
  it.todo("In-flight (still-started) duplicate returns pending_verification");
  it.todo("Failed run persists status='failed' so retries with same key don't re-submit");
  it.todo("/orders/submit-quote requires an idempotency key");
  it.todo("/quotes/revise requires an idempotency key");
  it.todo("/quotes/submit requires an idempotency key");
});
