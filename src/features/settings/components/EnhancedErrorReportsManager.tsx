import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Download, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  Clock,
  BarChart3,
  Filter,
  Search,
  Calendar,
  RefreshCw,
  ExternalLink,
  Code,
  Bug,
  Mouse,
  FileCode
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useErrorTracking } from '@/hooks/useErrorTracking';
import { RuntimeError } from '@/services/errorTrackingService';
import { ScrubberIssue } from '@/services/scrubberReportService';

const EnhancedErrorReportsManager = () => {
  const {
    runtimeErrors,
    scrubberIssues,
    updateRuntimeError,
    updateScrubberIssue,
    refreshScrubberReport,
    errorStats
  } = useErrorTracking();
  
  const [runtimeFilter, setRuntimeFilter] = useState<string>('all');
  const [scrubberFilter, setScrubberFilter] = useState<string>('all');
  const [runtimeSearch, setRuntimeSearch] = useState('');
  const [scrubberSearch, setScrubberSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshScrubber = async () => {
    setIsRefreshing(true);
    try {
      await refreshScrubberReport();
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredRuntimeErrors = runtimeErrors.filter(error => {
    const matchesFilter = runtimeFilter === 'all' || error.status === runtimeFilter;
    const matchesSearch = error.message.toLowerCase().includes(runtimeSearch.toLowerCase()) ||
                         (error.component || '').toLowerCase().includes(runtimeSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const filteredScrubberIssues = scrubberIssues.filter(issue => {
    const matchesFilter = scrubberFilter === 'all' || issue.status === scrubberFilter;
    const matchesSearch = (issue.classification || '').toLowerCase().includes(scrubberSearch.toLowerCase()) ||
                         (issue.file || '').toLowerCase().includes(scrubberSearch.toLowerCase()) ||
                         (issue.detail || '').toLowerCase().includes(scrubberSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'text-green-600 bg-green-50';
      case 'in-progress': return 'text-blue-600 bg-blue-50';
      case 'ignored': return 'text-gray-600 bg-gray-50';
      default: return 'text-red-600 bg-red-50';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-700 bg-red-100';
      case 'high': return 'text-orange-700 bg-orange-100';
      case 'medium': return 'text-yellow-700 bg-yellow-100';
      default: return 'text-blue-700 bg-blue-100';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'button_click': return <Mouse className="h-4 w-4" />;
      case 'js_error': return <Bug className="h-4 w-4" />;
      case 'navigation_failure': return <ExternalLink className="h-4 w-4" />;
      case 'dynamic': return <Mouse className="h-4 w-4" />;
      case 'static': return <FileCode className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const openFileInEditor = (file: string, line?: number) => {
    // This would need to be implemented based on your IDE/editor integration
    console.log(`Opening file: ${file}${line ? `:${line}` : ''}`);
  };

  const totalOpenIssues = errorStats.runtime.open + errorStats.scrubber.open;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Enhanced Error & Action Tracking</h2>
          <p className="text-muted-foreground">
            Real-time error monitoring and actionless button detection
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={totalOpenIssues > 0 ? "destructive" : "default"} className="text-lg px-3 py-1">
            {totalOpenIssues} Total Open Issues
          </Badge>
          <Button 
            onClick={handleRefreshScrubber} 
            disabled={isRefreshing}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
            Refresh Reports
          </Button>
        </div>
      </div>

      <Tabs defaultValue="runtime" className="space-y-6">
        <TabsList>
          <TabsTrigger value="runtime">Runtime Errors ({errorStats.runtime.open})</TabsTrigger>
          <TabsTrigger value="actionless">Actionless Buttons ({errorStats.scrubber.open})</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="runtime">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Bug className="h-5 w-5" />
                  Runtime Error Tracker
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search errors..."
                    value={runtimeSearch}
                    onChange={(e) => setRuntimeSearch(e.target.value)}
                    className="w-64"
                  />
                  <Select value={runtimeFilter} onValueChange={setRuntimeFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="ignored">Ignored</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredRuntimeErrors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {runtimeSearch || runtimeFilter !== 'all' ? 'No errors match your filters' : 'No runtime errors detected yet.'}
                  </div>
                ) : (
                  filteredRuntimeErrors.map((error) => (
                    <div key={error.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2">
                            {getTypeIcon(error.type)}
                            <Badge variant="outline" className="text-xs">
                              {error.type.replace('_', ' ')}
                            </Badge>
                            <Badge className={cn("text-xs", getSeverityColor(error.severity))}>
                              {error.severity}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {error.timestamp.toLocaleString()}
                            </span>
                          </div>
                          <p className="font-medium">{error.message}</p>
                          {error.component && (
                            <p className="text-sm text-muted-foreground">
                              Component: {error.component}
                            </p>
                          )}
                          {error.selector && (
                            <div className="text-xs bg-gray-50 p-2 rounded font-mono">
                              {error.selector}
                            </div>
                          )}
                          {error.stackTrace && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground">Stack trace</summary>
                              <pre className="mt-2 bg-gray-50 p-2 rounded text-xs overflow-x-auto">
                                {error.stackTrace}
                              </pre>
                            </details>
                          )}
                          {error.fixNotes && (
                            <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
                              Fix Notes: {error.fixNotes}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Badge className={cn("text-xs", getStatusColor(error.status))}>
                            {error.status}
                          </Badge>
                          <Select
                            value={error.status}
                            onValueChange={(status) => {
                              const fixNotes = status === 'resolved' 
                                ? prompt('Add fix notes (optional):') || undefined
                                : undefined;
                              updateRuntimeError(error.id, status as RuntimeError['status'], fixNotes);
                            }}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in-progress">In Progress</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="ignored">Ignored</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actionless">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Mouse className="h-5 w-5" />
                  Actionless Buttons & Static Analysis
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search issues..."
                    value={scrubberSearch}
                    onChange={(e) => setScrubberSearch(e.target.value)}
                    className="w-64"
                  />
                  <Select value={scrubberFilter} onValueChange={setScrubberFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="ignored">Ignored</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredScrubberIssues.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {scrubberSearch || scrubberFilter !== 'all' 
                      ? 'No issues match your filters' 
                      : 'No actionless buttons detected. Run the scrubber to analyze your app.'}
                  </div>
                ) : (
                  filteredScrubberIssues.map((issue) => (
                    <div key={issue.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2">
                            {getTypeIcon(issue.type)}
                            <Badge variant="outline" className="text-xs">
                              {issue.type} | {issue.classification}
                            </Badge>
                            <Badge className={cn("text-xs", getSeverityColor(issue.severity))}>
                              {issue.severity}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {issue.createdAt.toLocaleDateString()}
                            </span>
                          </div>
                          
                          {issue.type === 'static' && issue.file && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Code className="h-4 w-4" />
                                <span className="text-sm font-medium">{issue.file}</span>
                                {issue.line && (
                                  <Badge variant="outline" className="text-xs">
                                    Line {issue.line}
                                  </Badge>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openFileInEditor(issue.file!, issue.line)}
                                  className="h-6 text-xs"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  Open
                                </Button>
                              </div>
                              {issue.detail && (
                                <p className="text-sm text-muted-foreground pl-6">{issue.detail}</p>
                              )}
                            </div>
                          )}
                          
                          {issue.type === 'dynamic' && (
                            <div className="space-y-1">
                              {issue.pageUrl && (
                                <p className="text-sm">
                                  <span className="font-medium">Page:</span> {issue.pageUrl}
                                </p>
                              )}
                              {issue.selector && (
                                <div className="text-xs bg-gray-50 p-2 rounded font-mono">
                                  {issue.selector}
                                </div>
                              )}
                              {issue.label && (
                                <p className="text-sm">
                                  <span className="font-medium">Label:</span> {issue.label}
                                </p>
                              )}
                            </div>
                          )}
                          
                          {issue.fixNotes && (
                            <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
                              Fix Notes: {issue.fixNotes}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Badge className={cn("text-xs", getStatusColor(issue.status))}>
                            {issue.status}
                          </Badge>
                          <Select
                            value={issue.status}
                            onValueChange={(status) => {
                              const fixNotes = status === 'resolved' 
                                ? prompt('Add fix notes (optional):') || undefined
                                : undefined;
                              updateScrubberIssue(issue.id, status as ScrubberIssue['status'], fixNotes);
                            }}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in-progress">In Progress</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="ignored">Ignored</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Runtime Errors Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>Total Errors</span>
                    <Badge variant="outline">{errorStats.runtime.total}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Open Errors</span>
                    <Badge variant="destructive">{errorStats.runtime.open}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolved Errors</span>
                    <Badge variant="default">{errorStats.runtime.resolved}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Critical Errors</span>
                    <Badge variant="destructive">{errorStats.runtime.critical}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mouse className="h-5 w-5" />
                  Actionless Issues Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>Total Issues</span>
                    <Badge variant="outline">{errorStats.scrubber.total}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Open Issues</span>
                    <Badge variant="destructive">{errorStats.scrubber.open}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolved Issues</span>
                    <Badge variant="default">{errorStats.scrubber.resolved}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Dynamic Issues</span>
                    <Badge variant="secondary">{errorStats.scrubber.dynamic}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Static Issues</span>
                    <Badge variant="secondary">{errorStats.scrubber.static}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EnhancedErrorReportsManager;