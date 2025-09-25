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
  Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface IssueReport {
  id: string;
  issueNumber: number;
  title: string;
  description: string;
  status: 'open' | 'in-progress' | 'resolved' | 'wont-fix';
  severity: 'low' | 'medium' | 'high' | 'critical';
  section: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  reportData: any;
  fixNotes?: string;
}

interface WalkthroughReport {
  id: string;
  reportNumber: number;
  timestamp: Date;
  totalIssues: number;
  resolvedIssues: number;
  openIssues: number;
  sections: string[];
  issues: IssueReport[];
  reportSummary: string;
}

const ErrorReportsManager = () => {
  const [reports, setReports] = useState<WalkthroughReport[]>([]);
  const [issues, setIssues] = useState<IssueReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [issueCounter, setIssueCounter] = useState(1);

  useEffect(() => {
    loadReports();
    loadIssueCounter();
  }, []);

  const loadReports = () => {
    const savedReports = localStorage.getItem('walkthrough-reports');
    if (savedReports) {
      const parsed = JSON.parse(savedReports);
      setReports(parsed.map((r: any) => ({
        ...r,
        timestamp: new Date(r.timestamp),
        issues: r.issues.map((i: any) => ({
          ...i,
          createdAt: new Date(i.createdAt),
          updatedAt: new Date(i.updatedAt),
          resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : undefined
        }))
      })));
    }

    const savedIssues = localStorage.getItem('walkthrough-issues');
    if (savedIssues) {
      const parsed = JSON.parse(savedIssues);
      setIssues(parsed.map((i: any) => ({
        ...i,
        createdAt: new Date(i.createdAt),
        updatedAt: new Date(i.updatedAt),
        resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : undefined
      })));
    }
  };

  const loadIssueCounter = () => {
    const counter = localStorage.getItem('issue-counter');
    if (counter) {
      setIssueCounter(parseInt(counter));
    }
  };

  const saveReports = (newReports: WalkthroughReport[]) => {
    localStorage.setItem('walkthrough-reports', JSON.stringify(newReports));
    setReports(newReports);
  };

  const saveIssues = (newIssues: IssueReport[]) => {
    localStorage.setItem('walkthrough-issues', JSON.stringify(newIssues));
    setIssues(newIssues);
  };

  const saveIssueCounter = (counter: number) => {
    localStorage.setItem('issue-counter', counter.toString());
    setIssueCounter(counter);
  };

  const updateIssueStatus = (issueId: string, status: IssueReport['status'], fixNotes?: string) => {
    const updatedIssues = issues.map(issue => {
      if (issue.id === issueId) {
        const updated = {
          ...issue,
          status,
          updatedAt: new Date(),
          resolvedAt: status === 'resolved' ? new Date() : undefined,
          fixNotes: fixNotes || issue.fixNotes
        };
        return updated;
      }
      return issue;
    });

    saveIssues(updatedIssues);

    // Update reports that contain this issue
    const updatedReports = reports.map(report => ({
      ...report,
      issues: report.issues.map(issue => 
        issue.id === issueId 
          ? updatedIssues.find(u => u.id === issueId)!
          : issue
      ),
      resolvedIssues: report.issues.filter(i => 
        updatedIssues.find(u => u.id === i.id)?.status === 'resolved'
      ).length,
      openIssues: report.issues.filter(i => 
        updatedIssues.find(u => u.id === i.id)?.status !== 'resolved'
      ).length
    }));

    saveReports(updatedReports);
  };

  const deleteReport = (reportId: string) => {
    const updatedReports = reports.filter(r => r.id !== reportId);
    saveReports(updatedReports);
    
    if (selectedReport === reportId) {
      setSelectedReport(null);
    }
  };

  const exportReport = (report: WalkthroughReport) => {
    const markdown = `
# Walkthrough Report #${report.reportNumber}
**Generated:** ${report.timestamp.toLocaleString()}
**Total Issues:** ${report.totalIssues}
**Resolved Issues:** ${report.resolvedIssues}
**Open Issues:** ${report.openIssues}

## Issues Found

${report.issues.map(issue => `
### Issue #${issue.issueNumber} - ${issue.title}
**Status:** ${issue.status}
**Severity:** ${issue.severity}
**Section:** ${issue.section}
**Description:** ${issue.description}
${issue.errorMessage ? `**Error:** ${issue.errorMessage}` : ''}
${issue.fixNotes ? `**Fix Notes:** ${issue.fixNotes}` : ''}
**Created:** ${issue.createdAt.toLocaleString()}
${issue.resolvedAt ? `**Resolved:** ${issue.resolvedAt.toLocaleString()}` : ''}
`).join('\n')}

## Summary
${report.reportSummary}
    `;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `walkthrough-report-${report.reportNumber}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredIssues = issues.filter(issue => {
    const matchesFilter = filter === 'all' || issue.status === filter;
    const matchesSearch = issue.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         issue.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         issue.section.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'text-green-600 bg-green-50';
      case 'in-progress': return 'text-blue-600 bg-blue-50';
      case 'wont-fix': return 'text-gray-600 bg-gray-50';
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

  const openIssuesCount = issues.filter(i => i.status === 'open').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Error Reports & Issue Tracking</h2>
          <p className="text-muted-foreground">
            Track and manage issues found during system walkthroughs
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={openIssuesCount > 0 ? "destructive" : "default"} className="text-lg px-3 py-1">
            {openIssuesCount} Open Issues
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="issues" className="space-y-6">
        <TabsList>
          <TabsTrigger value="issues">Active Issues</TabsTrigger>
          <TabsTrigger value="reports">Walkthrough Reports</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="issues">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Issue Tracker</span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search issues..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64"
                  />
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="wont-fix">Won't Fix</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredIssues.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {searchTerm || filter !== 'all' ? 'No issues match your filters' : 'No issues found. Run a walkthrough to generate issues.'}
                  </div>
                ) : (
                  filteredIssues.map((issue) => (
                    <div key={issue.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">#{issue.issueNumber}</Badge>
                            <h3 className="font-semibold">{issue.title}</h3>
                            <Badge className={cn("text-xs", getSeverityColor(issue.severity))}>
                              {issue.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{issue.description}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Section: {issue.section}</span>
                            <span>Created: {issue.createdAt.toLocaleDateString()}</span>
                            {issue.resolvedAt && (
                              <span>Resolved: {issue.resolvedAt.toLocaleDateString()}</span>
                            )}
                          </div>
                          {issue.errorMessage && (
                            <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                              Error: {issue.errorMessage}
                            </div>
                          )}
                          {issue.fixNotes && (
                            <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
                              Fix Notes: {issue.fixNotes}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("text-xs", getStatusColor(issue.status))}>
                            {issue.status}
                          </Badge>
                          <Select
                            value={issue.status}
                            onValueChange={(status) => {
                              const fixNotes = status === 'resolved' 
                                ? prompt('Add fix notes (optional):') || undefined
                                : undefined;
                              updateIssueStatus(issue.id, status as IssueReport['status'], fixNotes);
                            }}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in-progress">In Progress</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="wont-fix">Won't Fix</SelectItem>
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

        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle>Walkthrough Reports History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {reports.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No reports generated yet. Run a comprehensive walkthrough to create your first report.
                  </div>
                ) : (
                  reports.map((report) => (
                    <div key={report.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Report #{report.reportNumber}</Badge>
                          <span className="font-semibold">
                            {report.timestamp.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => exportReport(report)}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Export
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteReport(report.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div className="text-center p-2 bg-gray-50 rounded">
                          <div className="font-semibold">{report.totalIssues}</div>
                          <div className="text-muted-foreground">Total Issues</div>
                        </div>
                        <div className="text-center p-2 bg-green-50 rounded">
                          <div className="font-semibold text-green-600">{report.resolvedIssues}</div>
                          <div className="text-muted-foreground">Resolved</div>
                        </div>
                        <div className="text-center p-2 bg-red-50 rounded">
                          <div className="font-semibold text-red-600">{report.openIssues}</div>
                          <div className="text-muted-foreground">Open</div>
                        </div>
                        <div className="text-center p-2 bg-blue-50 rounded">
                          <div className="font-semibold text-blue-600">{report.sections.length}</div>
                          <div className="text-muted-foreground">Sections</div>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Issue Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>Total Issues</span>
                    <Badge variant="outline">{issues.length}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Open Issues</span>
                    <Badge variant="destructive">{issues.filter(i => i.status === 'open').length}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolved Issues</span>
                    <Badge variant="default">{issues.filter(i => i.status === 'resolved').length}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>In Progress</span>
                    <Badge variant="secondary">{issues.filter(i => i.status === 'in-progress').length}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Severity Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {['critical', 'high', 'medium', 'low'].map(severity => (
                    <div key={severity} className="flex justify-between">
                      <span className="capitalize">{severity}</span>
                      <Badge className={getSeverityColor(severity)}>
                        {issues.filter(i => i.severity === severity).length}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {issues
                    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                    .slice(0, 5)
                    .map(issue => (
                      <div key={issue.id} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">#{issue.issueNumber}</Badge>
                        <span className="text-muted-foreground truncate">
                          {issue.title}
                        </span>
                        <Badge className={cn("text-xs", getStatusColor(issue.status))}>
                          {issue.status}
                        </Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ErrorReportsManager;