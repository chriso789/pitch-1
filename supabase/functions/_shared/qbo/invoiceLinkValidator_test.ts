// Phase 1B - item 3 (URL SAFETY) and item 10 (TESTS).
// Unit tests for the QBO hosted InvoiceLink validator. These MUST pass before
// any hosted link is persisted to invoice_ar_mirror.invoice_link.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateInvoiceLink } from "./invoiceLinkValidator.ts";

Deno.test("accepts a well-formed Intuit hosted link", () => {
  const r = validateInvoiceLink("https://app.qbo.intuit.com/pay/abc123");
  assertEquals(r.ok, true);
});

Deno.test("accepts a payments.intuit.com hosted link", () => {
  const r = validateInvoiceLink("https://connect.payments.intuit.com/pay/xyz");
  assertEquals(r.ok, true);
});

Deno.test("rejects http (not https)", () => {
  const r = validateInvoiceLink("http://app.qbo.intuit.com/pay/abc");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "protocol_not_https");
});

Deno.test("rejects javascript: pseudo-scheme", () => {
  const r = validateInvoiceLink("javascript:alert(1)");
  assertEquals(r.ok, false);
});

Deno.test("rejects data: URL", () => {
  const r = validateInvoiceLink("data:text/html,<script>alert(1)</script>");
  assertEquals(r.ok, false);
});

Deno.test("rejects host outside the allowlist", () => {
  const r = validateInvoiceLink("https://evil.example.com/pay/abc");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "host_not_in_allowlist");
});

Deno.test("rejects a look-alike host (intuit.com.evil.com)", () => {
  const r = validateInvoiceLink("https://intuit.com.evil.com/pay/abc");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "host_not_in_allowlist");
});

Deno.test("rejects embedded credentials", () => {
  const r = validateInvoiceLink("https://user:pass@app.qbo.intuit.com/pay/abc");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "embedded_credentials");
});

Deno.test("rejects bare IPv4 literal", () => {
  const r = validateInvoiceLink("https://1.2.3.4/pay/abc");
  assertEquals(r.ok, false);
});

Deno.test("rejects loopback host", () => {
  const r = validateInvoiceLink("https://localhost/pay/abc");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "private_or_loopback_host");
});

Deno.test("rejects private IPv4 (10.x)", () => {
  const r = validateInvoiceLink("https://10.0.0.1/pay/abc");
  assertEquals(r.ok, false);
});

Deno.test("rejects empty string", () => {
  const r = validateInvoiceLink("");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "empty_or_non_string");
});

Deno.test("rejects non-string", () => {
  const r = validateInvoiceLink(undefined as unknown as string);
  assertEquals(r.ok, false);
});

Deno.test("rejects malformed URL", () => {
  const r = validateInvoiceLink("::::not a url::::");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "malformed_url");
});

Deno.test("rejects url exceeding 2048 chars", () => {
  const r = validateInvoiceLink("https://app.qbo.intuit.com/pay/" + "a".repeat(2100));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "url_too_long");
});
