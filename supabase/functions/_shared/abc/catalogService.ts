/**
 * Shared ABC catalog service — Phase 1B, Slice 1.
 *
 * Single authority for building the Product API search/get requests and
 * shaping their responses. Both `abc-api-proxy` (legacy) and
 * `supplier-api/abc/proxy` (v2) import this module so the wire contract stays
 * byte-for-byte identical across the two handlers and the family/color/UOM
 * enrichment always runs through `normalizeAbcSearchResponse` /
 * `normalizeAbcCatalogItem`.
 *
 * Non-goals (deliberately excluded from this slice):
 *   • Auth / token acquisition          — handler-owned.
 *   • Audit logging                     — handler-owned.
 *   • Ship-To / branch verification     — Phase 1B Slice 2.
 *   • Pricing / order builder wiring    — later slices.
 *
 * Rules:
 *   • Never mutate caller input.
 *   • Never invent branchNumber / itemNumber. Only pass caller values through.
 *   • Never swallow WAF sentinels — surface `error_code` verbatim.
 *   • `itemsPerPage` clamped to [1, 100]; `pageNumber` defaults to 1.
 *   • Response body returned unchanged for auditing; `normalized` is additive.
 */

import type {
  NormalizedAbcCatalogItem,
  NormalizedAbcSearchResponse,
} from "./types.ts";
import {
  normalizeAbcCatalogItem,
  normalizeAbcSearchResponse,
} from "./productNormalizer.ts";

// ---------- HTTP contract ----------

export interface AbcHttpCallResult {
  status: number;
  json: unknown;
  text: string;
  ok: boolean;
  headers: Record<string, string>;
}

export type AbcCallAbc = (
  token: string,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
) => Promise<AbcHttpCallResult>;

export type AbcMapError = (status: number, body: unknown) => string;

/**
 * Handlers currently hold their own auth token, HTTP client, and error mapper.
 * They inject those here so this service can be unit-tested without duplicating
 * transport code. Later slices can migrate callers to `_shared/abc/http.ts`.
 */
export interface AbcCatalogHttpDeps {
  apiBase: string;
  token: string;
  callAbc: AbcCallAbc;
  mapAbcError: AbcMapError;
}

// ---------- Public inputs ----------

export interface SearchAbcCatalogInput {
  /** Exact itemNumber match. Takes precedence over `query`. */
  itemNumber?: string | null;
  /** Description contains-match. Ignored when itemNumber present. */
  query?: string | null;
  /** Optional branchNumber filter. Case preserved (upper-cased on wire). */
  branchNumber?: string | null;
  /** Page size, clamped to [1, 100]. Default 25. */
  itemsPerPage?: number | null;
  /** 1-based page. Default 1. */
  pageNumber?: number | null;
}

// ---------- Public outputs ----------

export interface AbcCatalogHttpResult<T> {
  success: boolean;
  endpoint: string;
  request?: unknown;
  status: number;
  /** Original raw body (json when parseable, else text). Preserved for audit. */
  body: unknown;
  error_code: string | null;
  /** Normalized projection. `null` when upstream call failed. */
  normalized: T | null;
}

// ---------- Helpers ----------

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clampItemsPerPage(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 25;
  return Math.min(Math.max(Math.trunc(n) || 25, 1), 100);
}

function clampPageNumber(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(Math.trunc(n) || 1, 1);
}

// ---------- search_products ----------

/**
 * Build the exact `POST /product/v1/search/items` payload the ABC Product API
 * expects. Exposed for tests and for handlers that need to audit the payload
 * before sending it (both handlers do).
 */
export function buildSearchProductsPayload(input: SearchAbcCatalogInput): {
  filters: Array<Record<string, unknown>>;
  pagination: { itemsPerPage: number; pageNumber: number };
} {
  const filters: Array<Record<string, unknown>> = [];
  const itemNumber = trim(input?.itemNumber);
  const query = trim(input?.query);

  if (itemNumber) {
    filters.push({
      key: "itemNumber",
      condition: "equals",
      values: [itemNumber],
      joinCondition: "and",
    });
  } else {
    filters.push({
      key: "itemDescription",
      condition: "contains",
      values: [query],
      joinCondition: "and",
    });
  }

  const branchNumber = trim(input?.branchNumber);
  if (branchNumber) {
    filters.push({
      key: "branchNumber",
      condition: "equals",
      values: [branchNumber],
      joinCondition: "and",
    });
  }

  return {
    filters,
    pagination: {
      itemsPerPage: clampItemsPerPage(input?.itemsPerPage),
      pageNumber: clampPageNumber(input?.pageNumber),
    },
  };
}

export async function searchAbcCatalog(
  deps: AbcCatalogHttpDeps,
  input: SearchAbcCatalogInput,
): Promise<AbcCatalogHttpResult<NormalizedAbcSearchResponse>> {
  const endpoint = `${deps.apiBase}/product/v1/search/items`;
  const payload = buildSearchProductsPayload(input);
  const r = await deps.callAbc(deps.token, "POST", endpoint, payload);
  const body = r.json ?? r.text;
  const error_code = r.ok ? null : deps.mapAbcError(r.status, r.json);
  const normalized = r.ok ? normalizeAbcSearchResponse(r.json as never) : null;

  return {
    success: r.ok,
    endpoint,
    request: payload,
    status: r.status,
    body,
    error_code,
    normalized,
  };
}

// ---------- get_item ----------

export async function getAbcCatalogItem(
  deps: AbcCatalogHttpDeps,
  itemNumber: string,
): Promise<AbcCatalogHttpResult<NormalizedAbcCatalogItem>> {
  const itm = trim(itemNumber);
  if (!itm) {
    throw new Error("itemNumber required");
  }
  const endpoint = `${deps.apiBase}/product/v1/items/${encodeURIComponent(itm)}`;
  const r = await deps.callAbc(deps.token, "GET", endpoint);
  const body = r.json ?? r.text;
  const error_code = r.ok ? null : deps.mapAbcError(r.status, r.json);

  let normalized: NormalizedAbcCatalogItem | null = null;
  if (r.ok && r.json && typeof r.json === "object") {
    // ABC returns either the item directly or wrapped under `data` / `item`.
    const j = r.json as Record<string, unknown>;
    const inner = (j.data ?? j.item ?? j) as Record<string, unknown>;
    normalized = normalizeAbcCatalogItem(inner as never);
  }

  return {
    success: r.ok,
    endpoint,
    status: r.status,
    body,
    error_code,
    normalized,
  };
}
