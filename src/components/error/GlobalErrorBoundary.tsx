import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportCrash } from '@/lib/MonitoringSelfHealing';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

/**
 * Global Error Boundary that catches all React component errors
 * and logs them to the monitoring system
 */
class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return {
      hasError: true,
      error,
      errorId
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to monitoring system
    reportCrash({
      error_type: 'react_error_boundary',
      error_message: error.message,
      stack_trace: error.stack,
      component: 'GlobalErrorBoundary',
      route: window.location.pathname,
      severity: 'critical',
      metadata: {
        errorId: this.state.errorId,
        componentStack: errorInfo.componentStack,
        url: window.location.href,
        timestamp: new Date().toISOString()
      }
    });

    // Also log to console for development
    console.error('[GlobalErrorBoundary] Caught error:', error);
    console.error('[GlobalErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/dashboard';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle className="text-xl">Something went wrong</CardTitle>
              <CardDescription>
                An unexpected error occurred. Our team has been notified.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {this.state.errorId && (
                <div className="bg-muted p-3 rounded-md text-center">
                  <p className="text-xs text-muted-foreground">Error Reference</p>
                  <p className="font-mono text-sm font-medium">{this.state.errorId}</p>
                </div>
              )}
              
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="bg-muted/50 p-3 rounded-md text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Technical Details
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap text-destructive overflow-auto max-h-40">
                    {this.state.error.message}
                    {'\n\n'}
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={this.handleGoHome}
                >
                  <Home className="h-4 w-4 mr-2" />
                  Go to Dashboard
                </Button>
                <Button 
                  className="flex-1"
                  onClick={this.handleReload}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reload Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
