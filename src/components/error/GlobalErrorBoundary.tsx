import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportCrash } from '@/lib/MonitoringSelfHealing';
import { AlertTriangle, RefreshCw, Home, Copy, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
  copied: boolean;
  detailsOpen: boolean;
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
      errorId: null,
      copied: false,
      detailsOpen: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return {
      hasError: true,
      error,
      errorId,
      copied: false,
      detailsOpen: false
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

  getDiagnostics = (): string => {
    const { error, errorId } = this.state;
    const lines: string[] = [
      `Error Reference: ${errorId || 'N/A'}`,
      `URL: ${window.location.href}`,
      `Route: ${window.location.pathname}`,
      `Timestamp: ${new Date().toISOString()}`,
      `User Agent: ${navigator.userAgent}`,
      '',
      `Error Name: ${error?.name || 'Unknown'}`,
      `Error Message: ${error?.message || 'No message'}`,
      '',
      'Stack Trace:',
      ...(error?.stack?.split('\n').slice(0, 30) || ['N/A']),
    ];
    return lines.join('\n');
  };

  handleCopyDiagnostics = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(this.getDiagnostics());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (err) {
      console.error('Failed to copy diagnostics:', err);
    }
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
              
              {/* Show error summary in production too */}
              {this.state.error && (
                <Collapsible 
                  open={this.state.detailsOpen} 
                  onOpenChange={(open) => this.setState({ detailsOpen: open })}
                >
                  <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted/50 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors">
                    <ChevronDown className={`h-3 w-3 transition-transform ${this.state.detailsOpen ? 'rotate-180' : ''}`} />
                    Technical Details
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 p-3 bg-muted/30 rounded-md space-y-2">
                      <div className="text-xs">
                        <span className="text-muted-foreground">Error: </span>
                        <span className="text-destructive font-medium">{this.state.error.name}</span>
                      </div>
                      <p className="text-xs text-destructive break-words">
                        {this.state.error.message}
                      </p>
                      {this.state.error.stack && (
                        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap overflow-auto max-h-24 mt-2 font-mono">
                          {this.state.error.stack.split('\n').slice(1, 5).join('\n')}
                        </pre>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 text-xs"
                        onClick={this.handleCopyDiagnostics}
                      >
                        {this.state.copied ? (
                          <>
                            <Check className="h-3 w-3 mr-1" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            Copy Diagnostics
                          </>
                        )}
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
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
