import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { format, subDays, startOfMonth, endOfMonth, startOfYear } from "date-fns";

export interface ReferralAnalyticsFilters {
  dateFrom: string;
  dateTo: string;
  campaignId?: string;
  referrerContactId?: string;
  serviceNeeded?: string;
  city?: string;
  zip?: string;
  utmSource?: string;
  utmCampaign?: string;
}

const KEYS = [
  "dateFrom", "dateTo", "campaignId", "referrerContactId",
  "serviceNeeded", "city", "zip", "utmSource", "utmCampaign",
] as const;

export type DatePreset =
  | "last_7" | "last_30" | "last_90" | "this_month" | "last_month" | "this_year" | "all_time";

export function rangeForPreset(p: DatePreset): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  switch (p) {
    case "last_7": return { dateFrom: iso(subDays(today, 7)), dateTo: iso(today) };
    case "last_30": return { dateFrom: iso(subDays(today, 30)), dateTo: iso(today) };
    case "last_90": return { dateFrom: iso(subDays(today, 90)), dateTo: iso(today) };
    case "this_month": return { dateFrom: iso(startOfMonth(today)), dateTo: iso(today) };
    case "last_month": {
      const lm = subDays(startOfMonth(today), 1);
      return { dateFrom: iso(startOfMonth(lm)), dateTo: iso(endOfMonth(lm)) };
    }
    case "this_year": return { dateFrom: iso(startOfYear(today)), dateTo: iso(today) };
    case "all_time": return { dateFrom: "2020-01-01", dateTo: iso(today) };
  }
}

export function useReferralAnalyticsFilters() {
  const [sp, setSp] = useSearchParams();

  const filters = useMemo<ReferralAnalyticsFilters>(() => {
    const def = rangeForPreset("last_90");
    return {
      dateFrom: sp.get("dateFrom") || def.dateFrom,
      dateTo: sp.get("dateTo") || def.dateTo,
      campaignId: sp.get("campaignId") || undefined,
      referrerContactId: sp.get("referrerContactId") || undefined,
      serviceNeeded: sp.get("serviceNeeded") || undefined,
      city: sp.get("city") || undefined,
      zip: sp.get("zip") || undefined,
      utmSource: sp.get("utmSource") || undefined,
      utmCampaign: sp.get("utmCampaign") || undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()]);

  const update = useCallback((patch: Partial<ReferralAnalyticsFilters>) => {
    const next = new URLSearchParams(sp);
    for (const k of KEYS) {
      if (k in patch) {
        const v = (patch as any)[k];
        if (v == null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
    }
    // Always preserve tab
    if (!next.get("tab")) next.set("tab", sp.get("tab") || "analytics");
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const setPreset = useCallback((p: DatePreset) => {
    update(rangeForPreset(p));
  }, [update]);

  const reset = useCallback(() => {
    const def = rangeForPreset("last_90");
    const next = new URLSearchParams();
    if (sp.get("tab")) next.set("tab", sp.get("tab")!);
    next.set("dateFrom", def.dateFrom);
    next.set("dateTo", def.dateTo);
    setSp(next, { replace: true });
  }, [sp, setSp]);

  return { filters, update, setPreset, reset };
}
