import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { qboHost, qboHostFromRealm, QBO_PROD_HOST, QBO_SANDBOX_HOST } from "../qbo-host.ts";

Deno.test("qboHost: sandbox connection returns sandbox host", () => {
  assertEquals(qboHost({ is_sandbox: true }), QBO_SANDBOX_HOST);
});

Deno.test("qboHost: production connection returns prod host", () => {
  assertEquals(qboHost({ is_sandbox: false }), QBO_PROD_HOST);
});

Deno.test("qboHost: null/undefined defaults to prod host", () => {
  assertEquals(qboHost(null), QBO_PROD_HOST);
  assertEquals(qboHost(undefined), QBO_PROD_HOST);
  assertEquals(qboHost({}), QBO_PROD_HOST);
});

Deno.test("qboHostFromRealm: returns sandbox host when row says sandbox", async () => {
  const fakeSupabase = {
    from: (_t: string) => ({
      select: (_s: string) => ({
        eq: (_c: string, _v: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({
            maybeSingle: () => Promise.resolve({
              data: { is_sandbox: true, tenant_id: "t1" },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  const result = await qboHostFromRealm(fakeSupabase as any, "realm-1");
  assertEquals(result.host, QBO_SANDBOX_HOST);
  assertEquals(result.isSandbox, true);
  assertEquals(result.tenantId, "t1");
});

Deno.test("qboHostFromRealm: returns prod host when no row found", async () => {
  const fakeSupabase = {
    from: (_t: string) => ({
      select: (_s: string) => ({
        eq: (_c: string, _v: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    }),
  };
  const result = await qboHostFromRealm(fakeSupabase as any, "realm-missing");
  assertEquals(result.host, QBO_PROD_HOST);
  assertEquals(result.isSandbox, false);
  assertEquals(result.tenantId, null);
});
