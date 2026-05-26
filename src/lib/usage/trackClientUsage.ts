// Client-side usage tracker. Posts to platform-api /track-client-usage
// which authenticates the caller's JWT and derives tenant_id server-side.
// Never throws — usage tracking must not break product code paths.

import { supabase } from "@/integrations/supabase/client";

export interface ClientUsageInput {
  provider: string;                 // e.g. "supabase", "mapbox", "openai"
  eventType: string;                // e.g. "storage_mb", "map_load"
  featureArea?: string | null;      // e.g. "storage", "canvassing"
  quantity?: number;
  unit?: string | null;
  metadata?: Record<string, unknown>;
}

export function trackClientUsage(input: ClientUsageInput): void {
  try {
    // Fire-and-forget — never await in callers.
    void supabase.functions.invoke("platform-api", {
      body: {
        __route: "/track-client-usage",
        provider: input.provider,
        event_type: input.eventType,
        feature_area: input.featureArea ?? null,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? null,
        metadata: input.metadata ?? {},
      },
      headers: { "x-route": "/track-client-usage" },
    });
  } catch {
    /* swallow */
  }
}

// ============================================================
// Debounced map-load tracker (Priority 3)
// One event per route+session every 5 minutes — no pan/zoom spam.
// ============================================================

const MAP_LOAD_DEBOUNCE_MS = 5 * 60 * 1000;
const mapLoadCache = new Map<string, number>();

export function trackMapLoad(opts: {
  route: string;
  page?: string;
  mapContext?: string;
  viewportCount?: number;
}) {
  const key = `${opts.route}::${opts.page ?? ""}::${opts.mapContext ?? ""}`;
  const now = Date.now();
  const last = mapLoadCache.get(key) ?? 0;
  if (now - last < MAP_LOAD_DEBOUNCE_MS) return;
  mapLoadCache.set(key, now);
  trackClientUsage({
    provider: "mapbox",
    eventType: "map_load",
    featureArea: "canvassing",
    quantity: 1,
    unit: "load",
    metadata: {
      route: opts.route,
      page: opts.page ?? null,
      map_context: opts.mapContext ?? null,
      viewport_count_if_available: opts.viewportCount ?? null,
    },
  });
}

import { useEffect } from "react";

/** Track a single map load (debounced) when a map component mounts. */
export function useMapLoadTracker(opts: { route: string; page?: string; mapContext?: string }) {
  useEffect(() => {
    trackMapLoad(opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.route, opts.page, opts.mapContext]);
}
