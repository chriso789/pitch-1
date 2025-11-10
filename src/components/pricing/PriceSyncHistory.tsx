import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SyncLog {
  id: string;
  sync_type: string;
  vendor_code: string;
  status: string;
  total_skus: number;
  successful_updates: number;
  failed_updates: number;
  started_at: string;
  completed_at: string | null;
  errors: any;
}

export const PriceSyncHistory = () => {
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchSyncLogs();
  }, []);

  const fetchSyncLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('price_sync_logs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setSyncLogs(data || []);
    } catch (error) {
      console.error('Failed to fetch sync logs:', error);
      toast({
        title: "Error",
        description: "Failed to load sync history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = {
      completed: { variant: "default" as const, icon: CheckCircle2, label: "Completed" },
      failed: { variant: "destructive" as const, icon: XCircle, label: "Failed" },
      running: { variant: "secondary" as const, icon: Clock, label: "Running" },
      partial: { variant: "secondary" as const, icon: AlertTriangle, label: "Partial" },
    };

    const { variant, icon: Icon, label } = config[status as keyof typeof config] || config.failed;

    return (
      <Badge variant={variant} className="flex items-center gap-1 w-fit">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  const getSyncTypeBadge = (syncType: string) => {
    const colors = {
      manual: "bg-blue-500/10 text-blue-500",
      scheduled: "bg-green-500/10 text-green-500",
      on_demand: "bg-purple-500/10 text-purple-500",
    };

    return (
      <Badge variant="outline" className={colors[syncType as keyof typeof colors] || ""}>
        {syncType}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-muted-foreground">Loading sync history...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Price Syncs</CardTitle>
        <CardDescription>
          History of all price refresh operations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {syncLogs.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            No sync operations yet. Start your first price sync to see history here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total SKUs</TableHead>
                <TableHead className="text-right">Success</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {syncLogs.map((log) => {
                const duration = log.completed_at
                  ? Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                  : null;

                return (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">
                      {formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.vendor_code}</Badge>
                    </TableCell>
                    <TableCell>{getSyncTypeBadge(log.sync_type)}</TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell className="text-right">{log.total_skus}</TableCell>
                    <TableCell className="text-right text-green-600">
                      {log.successful_updates}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {log.failed_updates}
                    </TableCell>
                    <TableCell>
                      {duration ? `${duration}s` : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
