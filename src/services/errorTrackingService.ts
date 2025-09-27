import { toast } from "@/hooks/use-toast";

export interface RuntimeError {
  id: string;
  timestamp: Date;
  type: 'button_click' | 'navigation_failure' | 'toast_error' | 'js_error' | 'api_error';
  component?: string;
  selector?: string;
  message: string;
  stackTrace?: string;
  url: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  status: 'open' | 'in-progress' | 'resolved' | 'ignored';
  severity: 'low' | 'medium' | 'high' | 'critical';
  fixNotes?: string;
  resolvedAt?: Date;
}

class ErrorTrackingService {
  private static instance: ErrorTrackingService;
  private errors: RuntimeError[] = [];
  private listeners: Array<(errors: RuntimeError[]) => void> = [];
  private isTracking = true;

  static getInstance(): ErrorTrackingService {
    if (!ErrorTrackingService.instance) {
      ErrorTrackingService.instance = new ErrorTrackingService();
    }
    return ErrorTrackingService.instance;
  }

  constructor() {
    this.loadErrors();
    this.setupGlobalErrorHandlers();
  }

  private loadErrors() {
    const saved = localStorage.getItem('runtime-errors');
    if (saved) {
      this.errors = JSON.parse(saved).map((e: any) => ({
        ...e,
        timestamp: new Date(e.timestamp),
        resolvedAt: e.resolvedAt ? new Date(e.resolvedAt) : undefined
      }));
    }
  }

  private saveErrors() {
    localStorage.setItem('runtime-errors', JSON.stringify(this.errors));
    this.notifyListeners();
  }

  private setupGlobalErrorHandlers() {
    // Global JavaScript error handler
    window.addEventListener('error', (event) => {
      if (!this.isTracking) return;
      
      this.trackError({
        type: 'js_error',
        message: event.message,
        stackTrace: event.error?.stack,
        url: event.filename || window.location.href,
        metadata: {
          lineno: event.lineno,
          colno: event.colno,
          filename: event.filename
        },
        severity: 'high'
      });
    });

    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
      if (!this.isTracking) return;
      
      this.trackError({
        type: 'js_error',
        message: `Unhandled promise rejection: ${event.reason}`,
        stackTrace: event.reason?.stack,
        url: window.location.href,
        severity: 'high'
      });
    });
  }

  trackError(errorData: Partial<RuntimeError>): string {
    const error: RuntimeError = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: errorData.type || 'js_error',
      message: errorData.message || 'Unknown error',
      url: errorData.url || window.location.href,
      userAgent: navigator.userAgent,
      status: 'open',
      severity: errorData.severity || 'medium',
      ...errorData
    };

    this.errors.unshift(error);
    
    // Keep only last 1000 errors to prevent storage overflow
    if (this.errors.length > 1000) {
      this.errors = this.errors.slice(0, 1000);
    }
    
    this.saveErrors();
    
    // Show toast for critical errors
    if (error.severity === 'critical') {
      toast({
        title: "Critical Error Detected",
        description: error.message,
        variant: "destructive",
      });
    }
    
    return error.id;
  }

  trackButtonClick(element: HTMLElement, outcome: 'success' | 'error' | 'no_action', details?: string) {
    if (!this.isTracking) return;

    const selector = this.generateSelector(element);
    const text = element.textContent?.trim() || 'Unknown button';
    
    if (outcome === 'error' || outcome === 'no_action') {
      this.trackError({
        type: 'button_click',
        component: element.tagName,
        selector,
        message: outcome === 'no_action' 
          ? `Button "${text}" clicked but no action occurred`
          : `Button "${text}" clicked but resulted in error: ${details}`,
        severity: outcome === 'no_action' ? 'medium' : 'high',
        metadata: {
          buttonText: text,
          outcome,
          details
        }
      });
    }
  }

  trackNavigationFailure(targetUrl: string, error: string) {
    if (!this.isTracking) return;

    this.trackError({
      type: 'navigation_failure',
      message: `Navigation to "${targetUrl}" failed: ${error}`,
      severity: 'medium',
      metadata: {
        targetUrl,
        currentUrl: window.location.href
      }
    });
  }

  trackToastError(toastMessage: string) {
    if (!this.isTracking) return;

    this.trackError({
      type: 'toast_error',
      message: `Error toast displayed: ${toastMessage}`,
      severity: 'low',
      metadata: {
        toastMessage
      }
    });
  }

  trackApiError(url: string, method: string, status: number, error: string) {
    if (!this.isTracking) return;

    this.trackError({
      type: 'api_error',
      message: `API ${method} ${url} failed with status ${status}: ${error}`,
      severity: status >= 500 ? 'high' : 'medium',
      metadata: {
        apiUrl: url,
        method,
        status,
        error
      }
    });
  }

  private generateSelector(element: HTMLElement): string {
    const parts: string[] = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector += `#${current.id}`;
        parts.unshift(selector);
        break;
      }
      
      if (current.className) {
        const classes = current.className.split(' ').filter(c => c.trim());
        if (classes.length > 0) {
          selector += `.${classes.slice(0, 2).join('.')}`;
        }
      }
      
      parts.unshift(selector);
      current = current.parentElement!;
      
      if (parts.length > 5) break; // Limit depth
    }
    
    return parts.join(' > ');
  }

  updateErrorStatus(errorId: string, status: RuntimeError['status'], fixNotes?: string) {
    const error = this.errors.find(e => e.id === errorId);
    if (error) {
      error.status = status;
      error.fixNotes = fixNotes;
      error.resolvedAt = status === 'resolved' ? new Date() : undefined;
      this.saveErrors();
    }
  }

  getErrors(): RuntimeError[] {
    return [...this.errors];
  }

  getErrorStats() {
    const total = this.errors.length;
    const open = this.errors.filter(e => e.status === 'open').length;
    const resolved = this.errors.filter(e => e.status === 'resolved').length;
    const critical = this.errors.filter(e => e.severity === 'critical').length;
    
    return { total, open, resolved, critical };
  }

  clearErrors() {
    this.errors = [];
    this.saveErrors();
  }

  subscribe(listener: (errors: RuntimeError[]) => void) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.errors]));
  }

  setTracking(enabled: boolean) {
    this.isTracking = enabled;
  }
}

export const errorTracker = ErrorTrackingService.getInstance();
