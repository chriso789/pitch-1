import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle, AlertCircle, RefreshCw, Filter, Download } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Database } from '@/integrations/supabase/types';

type FunctionLog = Database['public']['Tables']['function_logs']['Row'];

export const FunctionLogsMonitor = () => {
  const [logs, setLogs] = useState<FunctionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'success'>('all');
  const [functionFilter, setFunctionFilter] = useState<string>('all');
  const [functions, setFunctions] = useState<string[]>([]);

  useEffect(() => {
    fetchLogs();
    fetchFunctionNames();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('function-logs-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'function_logs'
        },
        (payload) => {
          setLogs((prev) => [payload.new as FunctionLog, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('function_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      if (functionFilter !== 'all') {
        query = query.eq('function_name', functionFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast.error('Failed to fetch function logs');
    } finally {
      setLoading(false);
    }
  };

  const fetchFunctionNames = async () => {
    try {
      const { data, error } = await supabase
        .from('function_logs')
        .select('function_name')
        .order('function_name');

      if (error) throw error;

      const uniqueFunctions = [...new Set(data?.map(d => d.function_name) || [])];
      setFunctions(uniqueFunctions);
    } catch (error) {
      console.error('Error fetching function names:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-warning" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      success: 'bg-success/10 text-success border-success/20',
      error: 'bg-destructive/10 text-destructive border-destructive/20',
      warning: 'bg-warning/10 text-warning border-warning/20'
    };

    return (
      <Badge className={variants[status] || ''}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  const exportLogs = () => {
    const csv = [
      ['Timestamp', 'Function', 'Status', 'Error Message', 'Duration (ms)'].join(','),
      ...logs.map(log => [
        log.created_at,
        log.function_name,
        log.status,
        log.error_message || '',
        log.duration_ms || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `function-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    toast.success('Logs exported successfully');
  };

  const errorLogs = logs.filter(l => l.status === 'error');
  const warningLogs = logs.filter(l => l.status === 'warning');
  const successRate = logs.length > 0 
    ? ((logs.filter(l => l.status === 'success').length / logs.length) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Logs</p>
                <p className="text-2xl font-bold">{logs.length}</p>
              </div>
              <RefreshCw className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Errors</p>
                <p className="text-2xl font-bold text-destructive">{errorLogs.length}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Warnings</p>
                <p className="text-2xl font-bold text-warning">{warningLogs.length}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold text-success">{successRate}%</p>
              </div>
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Function Execution Logs</CardTitle>
            <div className="flex gap-2">
              <select
                value={functionFilter}
                onChange={(e) => {
                  setFunctionFilter(e.target.value);
                  fetchLogs();
                }}
                className="px-3 py-1 border rounded-md text-sm"
              >
                <option value="all">All Functions</option>
                {functions.map(fn => (
                  <option key={fn} value={fn}>{fn}</option>
                ))}
              </select>
              
              <Button
                variant="outline"
                size="sm"
                onClick={exportLogs}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchLogs}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={filter} onValueChange={(v) => {
            setFilter(v as any);
            fetchLogs();
          }}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="error">Errors</TabsTrigger>
              <TabsTrigger value="warning">Warnings</TabsTrigger>
              <TabsTrigger value="success">Success</TabsTrigger>
            </TabsList>

            <TabsContent value={filter} className="mt-4">
              <ScrollArea className="h-[600px]">
                <div className="space-y-2">
                  {logs.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Filter className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No logs found</p>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <Card key={log.id} className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(log.status)}
                            <span className="font-mono text-sm font-medium">
                              {log.function_name}
                            </span>
                            {getStatusBadge(log.status)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(log.created_at), 'PPpp')}
                            {log.duration_ms && (
                              <span className="ml-2">({log.duration_ms}ms)</span>
                            )}
                          </div>
                        </div>

                        {log.error_message && (
                          <div className="mt-2 p-2 bg-destructive/5 border border-destructive/20 rounded text-sm">
                            <p className="font-medium text-destructive mb-1">Error:</p>
                            <p className="text-foreground/80">{log.error_message}</p>
                          </div>
                        )}

                        {log.error_stack && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              View Stack Trace
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {log.error_stack}
                            </pre>
                          </details>
                        )}

                        {Object.keys(log.context || {}).length > 0 && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              View Context
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {JSON.stringify(log.context, null, 2)}
                            </pre>
                          </details>
                        )}
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};