import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

interface ROIData {
  storm_event_id: string | null;
  jobs_won: number;
  revenue: number;
}

interface AreaROIPanelProps {
  tenantId: string;
  areaId: string;
  className?: string;
}

export default function AreaROIPanel({ tenantId, areaId, className }: AreaROIPanelProps) {
  const [data, setData] = useState<ROIData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: rows } = await supabase
        .from("canvass_area_roi" as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("area_id", areaId) as any;

      setData((rows as ROIData[]) || []);
      setLoading(false);
    };
    load();
  }, [tenantId, areaId]);

  const totalJobs = data.reduce((s, r) => s + (r.jobs_won || 0), 0);
  const totalRevenue = data.reduce((s, r) => s + (r.revenue || 0), 0);

  if (loading) return null;
  if (!data.length && !loading) return null;

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5" />
          Area ROI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Briefcase className="h-3 w-3" />
            Jobs Won
          </span>
          <span className="font-semibold">{totalJobs}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            Revenue
          </span>
          <span className="font-semibold">${totalRevenue.toLocaleString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}
