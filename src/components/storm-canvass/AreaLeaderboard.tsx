import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Trophy, Target, Phone, FileCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  user_id: string;
  contacted_properties: number;
  total_touchpoints: number;
  appts: number;
  contracts: number;
  user_name?: string;
}

interface AreaLeaderboardProps {
  tenantId: string;
  areaId: string;
  className?: string;
}

export default function AreaLeaderboard({ tenantId, areaId, className }: AreaLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const { data: rows } = await supabase
        .from("canvass_area_leaderboard" as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("area_id", areaId)
        .order("contacted_properties", { ascending: false });

      if (!rows?.length) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Fetch user names
      const userIds = rows.map((r: any) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", userIds);

      const nameMap = new Map<string, string>();
      profiles?.forEach((p: any) => {
        nameMap.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown");
      });

      setEntries(
        rows.map((r: any) => ({
          ...r,
          user_name: nameMap.get(r.user_id) || "Unknown",
        }))
      );
      setLoading(false);
    };

    load();
  }, [tenantId, areaId]);

  if (loading) return <p className="text-xs text-muted-foreground py-2">Loading...</p>;
  if (!entries.length) return <p className="text-xs text-muted-foreground py-2">No activity yet</p>;

  return (
    <div className={cn("space-y-1.5", className)}>
      {entries.map((entry, i) => (
        <div
          key={entry.user_id}
          className="flex items-center justify-between p-1.5 rounded-md bg-muted/50 text-xs"
        >
          <div className="flex items-center gap-1.5">
            {i === 0 && <Trophy className="h-3 w-3 text-primary" />}
            <span className="font-medium truncate max-w-[100px]">{entry.user_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
              <Target className="h-2.5 w-2.5" />
              {entry.contacted_properties}
            </Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
              <Phone className="h-2.5 w-2.5" />
              {entry.appts}
            </Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
              <FileCheck className="h-2.5 w-2.5" />
              {entry.contracts}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
