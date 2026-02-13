import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Loader2, TrendingUp, Shield, Home as HomeIcon, AlertTriangle, DollarSign } from "lucide-react";

interface Props {
  tenantId: string;
  stormEventId: string;
  normalizedAddressKey: string;
}

export default function StormScoreWhyPanel({ tenantId, stormEventId, normalizedAddressKey }: Props) {
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("storm_property_intel")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("storm_event_id", stormEventId)
        .eq("normalized_address_key", normalizedAddressKey)
        .single();

      if (!mounted) return;
      setRow(error ? null : data);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [tenantId, stormEventId, normalizedAddressKey]);

  const pills = useMemo(() => {
    if (!row) return [];
    const snap = row.property_snapshot || {};
    const claimF = row.claim_factors || {};
    const out: { label: string; tone: "good" | "warn" | "neutral" }[] = [];

    if (claimF?.absentee?.value) out.push({ label: "Absentee Owner", tone: "good" });
    if (snap.homestead === true) out.push({ label: "Homestead", tone: "warn" });
    if ((snap.year_built ?? 9999) <= 2005) out.push({ label: "Older Home", tone: "warn" });
    if ((row.damage_score ?? 0) >= 70) out.push({ label: "High Damage Risk", tone: "good" });
    if ((row.equity_score ?? 0) >= 70) out.push({ label: "High Equity", tone: "good" });
    return out;
  }, [row]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading score…
      </div>
    );
  }

  if (!row) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No intel record yet for this property.
      </div>
    );
  }

  const priorityColor = row.priority_score >= 70
    ? "text-green-600 bg-green-100 border-green-300"
    : row.priority_score >= 40
      ? "text-yellow-600 bg-yellow-100 border-yellow-300"
      : "text-red-600 bg-red-100 border-red-300";

  return (
    <div className="space-y-4 p-1">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">
            {row.property_snapshot?.property_address ?? row.normalized_address_key}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.property_snapshot?.owner_name ?? "Owner unknown"}
          </p>
        </div>
        <div className={cn("flex flex-col items-center rounded-lg border px-3 py-1.5 ml-3", priorityColor)}>
          <span className="text-[10px] font-medium leading-none">Priority</span>
          <span className="text-2xl font-bold leading-tight">{row.priority_score}</span>
        </div>
      </div>

      {/* Signal pills */}
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pills.map((p, i) => (
            <Badge
              key={i}
              variant="outline"
              className={cn(
                "text-[10px]",
                p.tone === "good" && "bg-green-50 text-green-700 border-green-200",
                p.tone === "warn" && "bg-yellow-50 text-yellow-700 border-yellow-200",
                p.tone === "neutral" && "bg-muted text-muted-foreground"
              )}
            >
              {p.tone === "good" && <TrendingUp className="h-2.5 w-2.5 mr-0.5" />}
              {p.tone === "warn" && <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />}
              {p.label}
            </Badge>
          ))}
        </div>
      )}

      <Separator />

      {/* Score bars */}
      <ScoreBar
        label="Damage Score"
        icon={<Shield className="h-3.5 w-3.5 text-red-500" />}
        value={row.damage_score}
        factors={row.damage_factors}
        color="bg-red-500"
      />
      <ScoreBar
        label="Equity Score"
        icon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />}
        value={row.equity_score}
        factors={row.equity_factors}
        color="bg-emerald-500"
      />
      <ScoreBar
        label="Claim Likelihood"
        icon={<HomeIcon className="h-3.5 w-3.5 text-blue-500" />}
        value={row.claim_likelihood_score}
        factors={row.claim_factors}
        color="bg-blue-500"
      />

      <Separator />

      {/* Explanation */}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Priority is a weighted blend of Claim ({Math.round((row.claim_factors?.damage?.weight ?? 0.55) * 100)}% damage + {Math.round((row.claim_factors?.equity?.weight ?? 0.20) * 100)}% equity) + Damage + Equity — configurable by your admin.
      </p>
    </div>
  );
}

function ScoreBar({
  label,
  icon,
  value,
  factors,
  color,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  factors: any;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <span className="text-sm font-bold">{value}</span>
      </div>
      <Progress value={value} className="h-2" />
      <p className="text-[10px] text-muted-foreground">{formatFactors(factors)}</p>
    </div>
  );
}

function formatFactors(f: any): string {
  if (!f || typeof f !== "object") return "No explanation available.";
  const parts: string[] = [];
  if (f.hail) parts.push(`Hail: ${f.hail.hail_in ?? 0}" (+${f.hail.points ?? 0})`);
  if (f.wind) parts.push(`Wind: ${f.wind.wind_mph ?? 0}mph (+${f.wind.points ?? 0})`);
  if (f.age) parts.push(`Age: ${f.age.roof_age_proxy ?? "?"}y (+${f.age.points ?? 0})`);
  if (f.est_equity_pct != null) parts.push(`Equity: ${(f.est_equity_pct * 100).toFixed(0)}%`);
  if (f.est_value != null) parts.push(`Value: $${Math.round(f.est_value).toLocaleString()}`);
  if (f.absentee) parts.push(`Absentee: ${f.absentee.value ? "Yes" : "No"} (${f.absentee.points > 0 ? "+" : ""}${f.absentee.points})`);
  if (f.homestead) parts.push(`Homestead: ${f.homestead.value ? "Yes" : "No"} (${f.homestead.adj > 0 ? "+" : ""}${f.homestead.adj})`);
  if (f.damage) parts.push(`Damage×${f.damage.weight}`);
  if (f.equity && typeof f.equity === "object" && f.equity.weight) parts.push(`Equity×${f.equity.weight}`);
  return parts.length ? parts.join(" • ") : "Factors captured.";
}
