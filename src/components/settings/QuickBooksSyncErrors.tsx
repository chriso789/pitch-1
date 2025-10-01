import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface QuickBooksSyncErrorsProps {
  tenantId: string;
}

interface SyncError {
  id: string;
  entity_type: string;
  entity_id: string;
  qbo_entity_id: string | null;
  error_type: string;
  error_message: string;
  retry_count: number;
  created_at: string;
  resolved_at: string | null;
}

export function QuickBooksSyncErrors({ tenantId }: QuickBooksSyncErrorsProps) {
  const queryClient = useQueryClient();

  const { data: errors, isLoading } = useQuery<SyncError[]>({
    queryKey: ['qbo-sync-errors', tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('qbo_sync_errors')
        .select('*')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as SyncError[];
    },
  });

  const resolveError = useMutation({
    mutationFn: async (errorId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { error } = await (supabase as any)
        .from('qbo_sync_errors')
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: session.user.id,
        })
        .eq('id', errorId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Error marked as resolved');
      queryClient.invalidateQueries({ queryKey: ['qbo-sync-errors', tenantId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to resolve error: ${error.message}`);
    },
  });

  if (isLoading) {
    return null;
  }

  if (!errors || errors.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">No sync errors</span>
        </div>
      </Card>
    );
  }

  const getErrorTypeColor = (type: string) => {
    switch (type) {
      case 'auth':
        return 'destructive';
      case 'validation':
        return 'default';
      case 'network':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Sync Errors
          </h3>
          <Badge variant="destructive">{errors.length} Unresolved</Badge>
        </div>

        <div className="space-y-3">
          {errors.map((error) => (
            <div
              key={error.id}
              className="p-4 border border-destructive/20 rounded-lg space-y-2"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={getErrorTypeColor(error.error_type)}>
                      {error.error_type}
                    </Badge>
                    <Badge variant="outline">{error.entity_type}</Badge>
                    {error.retry_count > 0 && (
                      <Badge variant="secondary">
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Retried {error.retry_count}x
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {error.error_message}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(error.created_at), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resolveError.mutate(error.id)}
                  disabled={resolveError.isPending}
                >
                  Mark Resolved
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
