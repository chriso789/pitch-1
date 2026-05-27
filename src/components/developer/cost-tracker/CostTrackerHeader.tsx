import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calculator, Download, Beaker, KeyRound } from "lucide-react";

type Props = {
  month: string | null;
  rollupStale: boolean;
  rollupAt: string | null;
  onRefresh: () => void;
  onRecalculate: () => void;
  onExport: () => void;
  onSeedFocus: () => void;
  onSecretFocus: () => void;
  busy?: boolean;
};

export default function CostTrackerHeader({
  month, rollupStale, rollupAt, onRefresh, onRecalculate, onExport, onSeedFocus, onSecretFocus, busy,
}: Props) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cost Tracker</h1>
        <p className="text-sm text-muted-foreground">
          Monitor real infrastructure usage, customer profitability, and plan limits across PITCH CRM.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {month && <Badge variant="outline">Month: {month}</Badge>}
          {rollupAt ? (
            <Badge variant="outline" className={rollupStale ? "border-amber-500/50 text-amber-700 dark:text-amber-400" : ""}>
              Rollups: {new Date(rollupAt).toLocaleString()} {rollupStale && "(stale)"}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
              Rollups never calculated
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={busy}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={onRecalculate} disabled={busy}>
          <Calculator className="mr-1.5 h-3.5 w-3.5" /> Recalculate Rollups
        </Button>
        <Button size="sm" variant="outline" onClick={onExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
        </Button>
        <Button size="sm" variant="outline" onClick={onSeedFocus}>
          <Beaker className="mr-1.5 h-3.5 w-3.5" /> Seed Test Events
        </Button>
        <Button size="sm" variant="outline" onClick={onSecretFocus}>
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Internal Secret
        </Button>
      </div>
    </div>
  );
}
