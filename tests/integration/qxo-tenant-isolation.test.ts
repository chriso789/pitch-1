/**
 * QXO Tenant Isolation — integration test scaffold.
 *
 * These tests document the cross-tenant denial contract for qxo-api.
 * They are marked `it.todo` because end-to-end execution requires the
 * Deno edge runtime + a seeded multi-tenant fixture. The contract they
 * cover is enforced today by:
 *   - supabase/functions/_shared/integrations/qxo-tenant-guard.ts
 *   - supabase/functions/qxo-api/index.ts (every route calls qxoTenantGuard)
 *   - The migration that added qxo_connections.authorization_status / scopes.
 *
 * When the Deno test harness lands, port each todo into a real test that
 * mocks `getBeaconAuth` + `globalThis.fetch` and asserts the response
 * envelope + supplier_audit_log row.
 */
import { describe, it } from "vitest";

describe("qxo-api tenant isolation", () => {
  it.todo("Tenant A user cannot list Tenant B QXO orders (body.tenant_id ignored)");
  it.todo("Tenant A user cannot read Tenant B QXO invoices");
  it.todo("Tenant A user cannot read Tenant B QXO quotes");
  it.todo("Tenant A user cannot submit an order using Tenant B QXO connection");
  it.todo("Body tenant_id is ignored when it differs from JWT-resolved tenant");
  it.todo("Missing QXO connection returns 412 qxo_connection_missing");
  it.todo("Revoked QXO connection returns 403 qxo_connection_revoked");
  it.todo("Expired (non-'connected') QXO connection returns 412 qxo_connection_not_ready");
  it.todo("Suspended (authorization_status != 'active') connection returns 403 qxo_not_authorized");
  it.todo("Missing 'order_submit' scope blocks /orders/submit with 403 qxo_scope_missing");
  it.todo("Missing 'invoice_read' scope blocks /invoices/list with 403 qxo_scope_missing");
  it.todo("Missing 'pricing' scope blocks /pricing/lookup with 403 qxo_scope_missing");
  it.todo("Audit row written to supplier_audit_log on every denied cross-tenant attempt");
  it.todo("Audit row written on every successful QXO action");
  it.todo("No response body contains 'username', 'password', 'access_token', or 'refresh_token'");
  it.todo("Audit metadata redacts token/password/secret/api_key keys");
});
