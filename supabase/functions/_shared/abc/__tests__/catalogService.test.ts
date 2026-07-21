// Deno tests for the shared ABC catalog service (Phase 1B, Slice 1).
// Run: deno test supabase/functions/_shared/abc/__tests__/catalogService.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildSearchProductsPayload,
  getAbcCatalogItem,
  searchAbcCatalog,
  type AbcCallAbc,
  type AbcHttpCallResult,
} from "../catalogService.ts";

const okResult = (json: unknown, status = 200): AbcHttpCallResult => ({
  status,
  json,
  text: JSON.stringify(json ?? ""),
  ok: status >= 200 && status < 300,
  headers: {},
});

const errResult = (status: number, json: unknown = { error: "nope" }): AbcHttpCallResult => ({
  status,
  json,
  text: JSON.stringify(json),
  ok: false,
  headers: {},
});

const mapAbcError = (status: number, _body: unknown) =>
  status === 499 ? "abc_waf_blocked" : `abc_http_${status}`;

Deno.test("buildSearchProductsPayload prefers itemNumber over query", () => {
  const p = buildSearchProductsPayload({ itemNumber: "  ABC-123  ", query: "shingles" });
  assertEquals(p.filters[0], {
    key: "itemNumber",
    condition: "equals",
    values: ["ABC-123"],
    joinCondition: "and",
  });
  assertEquals(p.pagination, { itemsPerPage: 25, pageNumber: 1 });
});

Deno.test("buildSearchProductsPayload falls back to description contains", () => {
  const p = buildSearchProductsPayload({ query: "shingles", branchNumber: "1209", itemsPerPage: 500 });
  assertEquals(p.filters[0].key, "itemDescription");
  assertEquals(p.filters[0].values, ["shingles"]);
  assertEquals(p.filters[1].key, "branchNumber");
  assertEquals(p.filters[1].values, ["1209"]);
  // Clamp to max 100.
  assertEquals(p.pagination.itemsPerPage, 100);
});

Deno.test("buildSearchProductsPayload clamps itemsPerPage lower bound", () => {
  const p = buildSearchProductsPayload({ query: "x", itemsPerPage: 0 });
  assertEquals(p.pagination.itemsPerPage, 25); // 0 → default 25
  const p2 = buildSearchProductsPayload({ query: "x", itemsPerPage: -3 });
  assertEquals(p2.pagination.itemsPerPage, 1); // negative → floor 1
});

Deno.test("searchAbcCatalog posts to correct endpoint and normalizes", async () => {
  let captured: { method: string; url: string; body: unknown } | null = null;
  const callAbc: AbcCallAbc = async (_t, method, url, body) => {
    captured = { method, url, body } as { method: string; url: string; body: unknown };
    return okResult({
      items: [
        {
          itemNumber: "SHNGL-1",
          itemDescription: "Test Shingle",
          uoms: [{ code: "BDL", isDefault: true }],
          branches: [{ branchNumber: "1209" }],
        },
      ],
    });
  };

  const r = await searchAbcCatalog(
    { apiBase: "https://api.test/api", token: "tok", callAbc, mapAbcError },
    { query: "shingle", branchNumber: "1209" },
  );

  assert(captured);
  const cap = captured as unknown as { method: string; url: string; body: unknown };
  assertEquals(cap.method, "POST");
  assertEquals(cap.url, "https://api.test/api/product/v1/search/items");
  assertEquals(r.success, true);
  assertEquals(r.status, 200);
  assertEquals(r.error_code, null);
  assertEquals(r.normalized?.items.length, 1);
  assertEquals(r.normalized?.items[0].itemNumber, "SHNGL-1");
});

Deno.test("searchAbcCatalog surfaces WAF sentinel via mapAbcError", async () => {
  const callAbc: AbcCallAbc = async () => errResult(499, { waf: true });
  const r = await searchAbcCatalog(
    { apiBase: "https://api.test/api", token: "tok", callAbc, mapAbcError },
    { query: "shingle" },
  );
  assertEquals(r.success, false);
  assertEquals(r.error_code, "abc_waf_blocked");
  assertEquals(r.normalized, null);
});

Deno.test("getAbcCatalogItem encodes item number and normalizes", async () => {
  let seenUrl = "";
  const callAbc: AbcCallAbc = async (_t, _m, url) => {
    seenUrl = url;
    return okResult({
      itemNumber: "GAF/HDZ",
      itemDescription: "GAF Timberline HDZ",
      uoms: [{ code: "BDL" }],
      branches: [],
    });
  };
  const r = await getAbcCatalogItem(
    { apiBase: "https://api.test/api", token: "tok", callAbc, mapAbcError },
    "GAF/HDZ",
  );
  assertEquals(seenUrl, "https://api.test/api/product/v1/items/GAF%2FHDZ");
  assertEquals(r.success, true);
  assertEquals(r.normalized?.itemNumber, "GAF/HDZ");
});

Deno.test("getAbcCatalogItem unwraps { data } and { item } envelopes", async () => {
  const callAbc: AbcCallAbc = async () =>
    okResult({ data: { itemNumber: "X-1", itemDescription: "wrapped", uoms: [], branches: [] } });
  const r = await getAbcCatalogItem(
    { apiBase: "https://api.test/api", token: "tok", callAbc, mapAbcError },
    "X-1",
  );
  assertEquals(r.normalized?.itemNumber, "X-1");
});

Deno.test("getAbcCatalogItem throws on empty itemNumber", async () => {
  const callAbc: AbcCallAbc = async () => okResult({});
  await assertRejects(
    () =>
      getAbcCatalogItem(
        { apiBase: "https://api.test/api", token: "tok", callAbc, mapAbcError },
        "   ",
      ),
    Error,
    "itemNumber required",
  );
});
