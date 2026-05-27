import type { StatusKind } from "@/lib/developer/costTrackerApi";
import { targetInfraCost } from "@/lib/developer/planTemplates";

export const STATUS_STYLE: Record<StatusKind, string> = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  watch: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  bad: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  losing_money: "bg-destructive/15 text-destructive border-destructive/30",
  over_cost: "bg-destructive/15 text-destructive border-destructive/30",
  no_data: "bg-muted text-muted-foreground border-border",
};

export const STATUS_LABEL: Record<StatusKind, string> = {
  good: "Good",
  watch: "Watch",
  bad: "Bad",
  losing_money: "Losing money",
  over_cost: "Over plan cost",
  no_data: "No data",
};

export function resolveStatus(
  margin: number,
  costMtd: number,
  monthlyPrice: number,
  eventCount = 1,
): StatusKind {
  if (eventCount === 0) return "no_data";
  if (margin < 0) return "losing_money";
  if (monthlyPrice > 0 && costMtd > targetInfraCost(monthlyPrice)) return "over_cost";
  if (margin < 40) return "bad";
  if (margin < 70) return "watch";
  return "good";
}

export function progressTone(percent: number) {
  if (percent > 100) return "bg-destructive";
  if (percent >= 90) return "bg-orange-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

export const fmtMoney = (n: number | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;
export const fmtPct = (n: number | null | undefined) => `${(Number(n) || 0).toFixed(1)}%`;
export const fmtNum = (n: number | null | undefined) => (Number(n) || 0).toLocaleString();
