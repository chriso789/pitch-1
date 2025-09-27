import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface EstimateStatusProps {
  estimateId: string;
}

interface EstimateStatusData {
  estimate_id: string;
  template_bound: boolean;
  measurements_present: boolean;
  ready: boolean;
  slider_disabled: boolean;
  last_computed_at: string | null;
  mode: 'margin' | 'markup' | null;
  margin_pct: number | null;
  markup_pct: number | null;
  next_required: string[];
  messages: string[];
}

export function EstimateStatus({ estimateId }: EstimateStatusProps) {
  const [status, setStatus] = useState<EstimateStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.rpc('api_estimate_status_get', {
          p_estimate_id: estimateId
        });

        if (error) throw error;
        setStatus(data as unknown as EstimateStatusData);
      } catch (err) {
        console.error('Error fetching estimate status:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch status');
      } finally {
        setLoading(false);
      }
    };

    if (estimateId) {
      fetchStatus();
    }
  }, [estimateId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimate Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!status) return null;

  const getStatusIcon = (completed: boolean) => {
    return completed ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : (
      <Clock className="h-4 w-4 text-yellow-500" />
    );
  };

  const getStatusBadge = (ready: boolean) => {
    return ready ? (
      <Badge className="bg-green-100 text-green-800 border-green-200">Ready</Badge>
    ) : (
      <Badge variant="secondary">Pending</Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Estimate Status
          {getStatusBadge(status.ready)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Items */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {getStatusIcon(status.template_bound)}
            <span className={status.template_bound ? 'text-foreground' : 'text-muted-foreground'}>
              Template Bound
            </span>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon(status.measurements_present)}
            <span className={status.measurements_present ? 'text-foreground' : 'text-muted-foreground'}>
              Measurements Present
            </span>
          </div>
        </div>

        {/* Messages */}
        {status.messages.length > 0 && (
          <div className="space-y-2">
            {status.messages.map((message, index) => (
              <Alert key={index}>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Next Steps */}
        {status.next_required.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Next Required Steps:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {status.next_required.map((step, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  {step === 'template' ? 'Bind Template' : 'Add Measurements'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Status Details */}
        {status.ready && (
          <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
            <div>Mode: {status.mode || 'Not set'}</div>
            {status.margin_pct && <div>Margin: {status.margin_pct}%</div>}
            {status.last_computed_at && (
              <div>Last computed: {new Date(status.last_computed_at).toLocaleString()}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}