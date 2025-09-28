export interface ScrubberIssue {
  id: string;
  type: 'dynamic' | 'static';
  classification: string;
  file?: string;
  line?: number;
  selector?: string;
  label?: string;
  href?: string;
  pageUrl?: string;
  kind?: string;
  detail?: string;
  status: 'open' | 'in-progress' | 'resolved' | 'ignored';
  severity: 'low' | 'medium' | 'high' | 'critical';
  fixNotes?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface ScrubberReport {
  generatedAt: string;
  totals: {
    dynamicTested: number;
    dynamicActionless: number;
    staticSuspects: number;
  };
  dynamicAnomalies: Array<{
    pageUrl: string;
    element?: {
      selector: string;
      label?: string;
      href?: string;
    };
    classification: string;
  }>;
  staticActionless: Array<{
    kind: string;
    file: string;
    line: number;
    detail: string;
  }>;
}

class ScrubberReportService {
  private static instance: ScrubberReportService;
  private issues: ScrubberIssue[] = [];
  private listeners: Array<(issues: ScrubberIssue[]) => void> = [];

  static getInstance(): ScrubberReportService {
    if (!ScrubberReportService.instance) {
      ScrubberReportService.instance = new ScrubberReportService();
    }
    return ScrubberReportService.instance;
  }

  constructor() {
    this.loadIssues();
  }

  private loadIssues() {
    const saved = localStorage.getItem('scrubber-issues');
    if (saved) {
      this.issues = JSON.parse(saved).map((i: any) => ({
        ...i,
        createdAt: new Date(i.createdAt),
        resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : undefined
      }));
    }
  }

  private saveIssues() {
    localStorage.setItem('scrubber-issues', JSON.stringify(this.issues));
    this.notifyListeners();
  }

  async loadScrubberReport(): Promise<ScrubberReport | null> {
    try {
      // Try to read the scrubber output file
      const response = await fetch('/tools/scrubber/out/scrub-merged.json');
      if (!response.ok) {
        return null;
      }
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Scrubber report is not JSON, skipping...');
        return null;
      }
      
      const report: ScrubberReport = await response.json();
      this.processScrubberReport(report);
      return report;
      
    } catch (error) {
      console.warn('Could not load scrubber report:', error);
      return null;
    }
  }

  private processScrubberReport(report: ScrubberReport) {
    const newIssues: ScrubberIssue[] = [];

    // Process dynamic anomalies
    report.dynamicAnomalies.forEach((anomaly, index) => {
      const existingIssue = this.issues.find(i => 
        i.type === 'dynamic' && 
        i.pageUrl === anomaly.pageUrl && 
        i.selector === anomaly.element?.selector
      );

      if (!existingIssue) {
        newIssues.push({
          id: crypto.randomUUID(),
          type: 'dynamic',
          classification: anomaly.classification,
          pageUrl: anomaly.pageUrl,
          selector: anomaly.element?.selector,
          label: anomaly.element?.label,
          href: anomaly.element?.href,
          status: 'open',
          severity: this.getSeverityFromClassification(anomaly.classification),
          createdAt: new Date()
        });
      }
    });

    // Process static actionless issues
    report.staticActionless.forEach((issue, index) => {
      const existingIssue = this.issues.find(i => 
        i.type === 'static' && 
        i.file === issue.file && 
        i.line === issue.line && 
        i.kind === issue.kind
      );

      if (!existingIssue) {
        newIssues.push({
          id: crypto.randomUUID(),
          type: 'static',
          classification: issue.kind,
          file: issue.file,
          line: issue.line,
          kind: issue.kind,
          detail: issue.detail,
          status: 'open',
          severity: this.getSeverityFromKind(issue.kind),
          createdAt: new Date()
        });
      }
    });

    if (newIssues.length > 0) {
      this.issues = [...newIssues, ...this.issues];
      this.saveIssues();
    }
  }

  private getSeverityFromClassification(classification: string): ScrubberIssue['severity'] {
    switch (classification) {
      case 'BROKEN_ENDPOINT':
      case 'JS_ERROR':
        return 'high';
      case 'NAV_ERROR':
      case 'ACTIONLESS':
        return 'medium';
      default:
        return 'low';
    }
  }

  private getSeverityFromKind(kind: string): ScrubberIssue['severity'] {
    switch (kind) {
      case 'MISSING_API':
      case 'MISSING_FN':
        return 'high';
      case 'NO_HANDLER':
        return 'medium';
      case 'ANCHOR_NO_HREF':
        return 'low';
      default:
        return 'medium';
    }
  }

  updateIssueStatus(issueId: string, status: ScrubberIssue['status'], fixNotes?: string) {
    const issue = this.issues.find(i => i.id === issueId);
    if (issue) {
      issue.status = status;
      issue.fixNotes = fixNotes;
      issue.resolvedAt = status === 'resolved' ? new Date() : undefined;
      this.saveIssues();
    }
  }

  getIssues(): ScrubberIssue[] {
    return [...this.issues];
  }

  getIssueStats() {
    const total = this.issues.length;
    const open = this.issues.filter(i => i.status === 'open').length;
    const resolved = this.issues.filter(i => i.status === 'resolved').length;
    const dynamic = this.issues.filter(i => i.type === 'dynamic').length;
    const static_ = this.issues.filter(i => i.type === 'static').length;
    
    return { total, open, resolved, dynamic, static: static_ };
  }

  clearIssues() {
    this.issues = [];
    this.saveIssues();
  }

  subscribe(listener: (issues: ScrubberIssue[]) => void) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.issues]));
  }
}

export const scrubberReportService = ScrubberReportService.getInstance();