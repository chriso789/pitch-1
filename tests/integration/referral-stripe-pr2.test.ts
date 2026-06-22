/**
 * PR #2 — Referral attribution + Stripe subscription webhook smoke tests.
 *
 * These tests are scaffolds for staging-mode verification. They exercise the
 * public contract of the three functions affected by PR #2:
 *
 *   - attach-crm-referral-to-new-company  (idempotent, non-fatal no-match)
 *   - sync-crm-referral-subscription-status (status mapping, payout guard)
 *   - stripe-webhook (signature, dedup, subscription lifecycle routing)
 *
 * Required env (read from .env.test via dotenv in the runner):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY
 *   INTERNAL_WORKER_SECRET     (matches the deployed secret in staging)
 *   STRIPE_WEBHOOK_SECRET      (for signing synthetic events)
 *
 * The cases below describe the behavior contract. They are intentionally
 * marked .skip until the staging fixture seeds (partner / signup rows / tenant
 * with stripe_customer_id) are in place — running them blindly against prod
 * would mutate live referral state.
 */

import { describe, it, expect } from "vitest";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const INTERNAL_SECRET = process.env.INTERNAL_WORKER_SECRET ?? "";

const fnUrl = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;

describe.skip("PR #2 — referral attribution", () => {
  it("attaches a matching unclaimed signup to the new company", async () => {
    const res = await fetch(fnUrl("attach-crm-referral-to-new-company"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({
        company_id: "TEST_TENANT_UUID",
        owner_user_id: "TEST_USER_UUID",
        owner_email: "owner@fixture.test",
        partner_code: "FIXTURE_PARTNER",
      }),
    });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.attributed).toBe(true);
    expect(j.signup_id).toBeTruthy();
  });

  it("is idempotent for the same company", async () => {
    const res = await fetch(fnUrl("attach-crm-referral-to-new-company"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({ company_id: "TEST_TENANT_UUID", owner_email: "owner@fixture.test" }),
    });
    const j = await res.json();
    expect(j.idempotent).toBe(true);
  });

  it("returns attributed=false but 200 when no match exists", async () => {
    const res = await fetch(fnUrl("attach-crm-referral-to-new-company"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({ company_id: "NO_REFERRAL_TENANT_UUID" }),
    });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.attributed).toBe(false);
    expect(j.reason).toBe("no_match");
  });
});

describe.skip("PR #2 — sync-crm-referral-subscription-status", () => {
  it("transitions to active_paid and creates exactly one payout", async () => {
    const res = await fetch(fnUrl("sync-crm-referral-subscription-status"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({
        company_id: "TEST_TENANT_UUID",
        status: "active_paid",
        paid_amount: 199,
        stripe_event_id: "evt_test_001",
        stripe_event_type: "invoice.paid",
      }),
    });
    const j = await res.json();
    expect(j.success).toBe(true);
    expect(j.next_status).toBe("active_paid");
    expect(j.payout_created).toBe(true);

    // Re-fire same event — payout must NOT duplicate
    const res2 = await fetch(fnUrl("sync-crm-referral-subscription-status"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({
        company_id: "TEST_TENANT_UUID",
        status: "active_paid",
        paid_amount: 199,
        stripe_event_id: "evt_test_001",
        stripe_event_type: "invoice.paid",
      }),
    });
    const j2 = await res2.json();
    expect(j2.payout_created).toBe(false);
  });

  it("maps cancellation to churned", async () => {
    const res = await fetch(fnUrl("sync-crm-referral-subscription-status"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({
        company_id: "TEST_TENANT_UUID",
        status: "canceled",
        stripe_event_id: "evt_test_002",
        stripe_event_type: "customer.subscription.deleted",
      }),
    });
    const j = await res.json();
    expect(j.next_status).toBe("churned");
  });
});

describe.skip("PR #2 — stripe-webhook subscription lifecycle", () => {
  it("rejects requests with no/invalid signature", async () => {
    const res = await fetch(fnUrl("stripe-webhook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "evt_unsigned", type: "invoice.paid", data: { object: {} } }),
    });
    expect(res.status).toBe(400);
  });

  // Remaining cases require Stripe.webhooks.generateTestHeaderString with
  // STRIPE_WEBHOOK_SECRET. Wire those up in the staging fixture.
  it.todo("checkout.session.completed (mode=subscription) links tenants.stripe_customer_id");
  it.todo("invoice.paid -> sync called -> signup_status=active_paid + history row");
  it.todo("invoice.payment_failed -> signup_status=payment_failed");
  it.todo("customer.subscription.deleted -> signup_status=churned");
  it.todo("duplicate stripe_event_id is ignored on second delivery");
  it.todo("unresolved company -> processing_error=unresolved_company, 200 OK");
});
