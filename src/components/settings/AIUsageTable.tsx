import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import type { AIUsageMetric } from "@/hooks/useAIUsageMetrics";

interface AIUsageTableProps {
  history: AIUsageMetric[];
}

export const AIUsageTable = ({ history }: AIUsageTableProps) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'default';
      case 'error':
        return 'destructive';
      case 'rate_limited':
        return 'secondary';
      case 'payment_required':
        return 'outline';
      default:
        return 'default';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'claude':
        return 'default';
      case 'openai':
        return 'secondary';
      case 'lovable-ai':
        return 'outline';
      default:
        return 'outline';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request History</CardTitle>
        <CardDescription>Recent AI API requests and their performance</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Time (ms)</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No AI requests yet. Start using AI features to see metrics here.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((metric) => (
                  <TableRow key={metric.id}>
                    <TableCell className="font-mono text-xs">
                      {format(new Date(metric.created_at), 'MMM dd HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getProviderColor(metric.provider)}>
                        {metric.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {metric.model}
                    </TableCell>
                    <TableCell className="capitalize">
                      {metric.feature.replace(/-/g, ' ')}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {metric.total_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {metric.response_time_ms}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ${metric.estimated_cost_usd.toFixed(4)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusColor(metric.status)}>
                        {metric.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
