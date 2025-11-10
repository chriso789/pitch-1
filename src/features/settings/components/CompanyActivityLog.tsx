import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCompanyActivityLog } from '@/hooks/useCompanyActivityLog';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { Download, RefreshCw, Search, AlertTriangle, Info, AlertCircle, Filter } from 'lucide-react';
import { format } from 'date-fns';

export const CompanyActivityLog = () => {
  const { companies, activeCompany } = useCompanySwitcher();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTenantId, setFilterTenantId] = useState<string>('all');
  const [filterActionType, setFilterActionType] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  const { logs, loading, refetch, exportLogs } = useCompanyActivityLog({
    tenantId: filterTenantId !== 'all' ? filterTenantId : undefined,
    actionType: filterActionType !== 'all' ? filterActionType : undefined,
    severity: filterSeverity !== 'all' ? filterSeverity : undefined,
    limit: 200,
  });

  const filteredLogs = logs.filter(log => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.action_description.toLowerCase().includes(query) ||
      log.user_email?.toLowerCase().includes(query) ||
      log.tenant_name?.toLowerCase().includes(query) ||
      log.action_type.toLowerCase().includes(query)
    );
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getActionTypeColor = (actionType: string) => {
    switch (actionType) {
      case 'company_switch':
        return 'default';
      case 'data_access':
        return 'secondary';
      case 'critical_operation':
        return 'destructive';
      case 'permission_change':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const actionTypes = [
    { value: 'all', label: 'All Actions' },
    { value: 'company_switch', label: 'Company Switches' },
    { value: 'data_access', label: 'Data Access' },
    { value: 'user_login', label: 'User Logins' },
    { value: 'user_logout', label: 'User Logouts' },
    { value: 'settings_change', label: 'Settings Changes' },
    { value: 'permission_change', label: 'Permission Changes' },
    { value: 'data_export', label: 'Data Exports' },
    { value: 'bulk_action', label: 'Bulk Actions' },
    { value: 'critical_operation', label: 'Critical Operations' },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company Activity Log</CardTitle>
          <CardDescription>
            Comprehensive audit trail of company switches, data access, and user actions across all companies you manage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={filterTenantId} onValueChange={setFilterTenantId}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Filter by company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.tenant_id} value={company.tenant_id}>
                    {company.tenant_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterActionType} onValueChange={setFilterActionType}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                {actionTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportLogs('csv')}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportLogs('json')}>
              <Download className="h-4 w-4 mr-2" />
              Export JSON
            </Button>
            <div className="ml-auto text-sm text-muted-foreground">
              {filteredLogs.length} log{filteredLogs.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Logs List */}
          <ScrollArea className="h-[600px] rounded-md border">
            <div className="p-4 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                  Loading activity logs...
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Filter className="h-12 w-12 mb-3 opacity-20" />
                  <p className="text-sm">No activity logs found</p>
                  <p className="text-xs mt-1">Try adjusting your filters</p>
                </div>
              ) : (
                filteredLogs.map((log) => (
                  <Card key={log.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        {getSeverityIcon(log.severity)}
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{log.action_description}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge variant={getSeverityColor(log.severity as any)} className="text-xs">
                                {log.severity}
                              </Badge>
                              <Badge variant={getActionTypeColor(log.action_type)} className="text-xs">
                                {log.action_type.replace(/_/g, ' ')}
                              </Badge>
                              {log.resource_type && (
                                <Badge variant="outline" className="text-xs">
                                  {log.resource_type}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground text-right whitespace-nowrap">
                            {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>
                            <span className="font-medium">User:</span> {log.user_email || 'Unknown'}
                          </span>
                          <span>•</span>
                          <span>
                            <span className="font-medium">Company:</span> {log.tenant_name || 'Unknown'}
                          </span>
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              View metadata
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
