import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Bot, AlertTriangle, CheckCircle, Copy, Wrench } from "lucide-react";
import { useAIErrorFixer, DiagnosisResult } from "@/hooks/useAIErrorFixer";
import { toast } from "sonner";

interface AIFixModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errorMessage: string;
  errorType?: string;
  stackTrace?: string;
  url?: string;
  metadata?: Record<string, any>;
}

export function AIFixModal({
  open,
  onOpenChange,
  errorMessage,
  errorType,
  stackTrace,
  url,
  metadata
}: AIFixModalProps) {
  const { analyzeError, isAnalyzing, diagnosis, error, reset } = useAIErrorFixer();
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const handleAnalyze = async () => {
    setHasAnalyzed(true);
    await analyzeError({
      message: errorMessage,
      type: errorType,
      stackTrace,
      url: url || window.location.href,
      metadata
    });
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation
    setTimeout(() => {
      reset();
      setHasAnalyzed(false);
    }, 200);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const getSeverityColor = (severity: DiagnosisResult['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-muted';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            AI Error Diagnosis
          </DialogTitle>
          <DialogDescription>
            AI-powered analysis of the error to help identify the root cause and fix
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error Summary */}
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm font-medium text-destructive">Error Message:</p>
            <p className="text-sm text-muted-foreground mt-1 break-words">{errorMessage}</p>
          </div>

          {/* Analysis Button or Results */}
          {!hasAnalyzed ? (
            <div className="flex justify-center py-4">
              <Button onClick={handleAnalyze} className="gap-2">
                <Wrench className="h-4 w-4" />
                Analyze & Find Fix
              </Button>
            </div>
          ) : isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">AI is analyzing the error...</p>
            </div>
          ) : error && !diagnosis ? (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Analysis Failed</p>
                  <p className="text-sm text-muted-foreground mt-1">{error}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleAnalyze}>
                Try Again
              </Button>
            </div>
          ) : diagnosis ? (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-4 pr-4">
                {/* Error Type & Severity */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium">{diagnosis.errorType}</span>
                  </div>
                  <Badge className={`${getSeverityColor(diagnosis.severity)} text-white`}>
                    {diagnosis.severity.toUpperCase()}
                  </Badge>
                </div>

                {/* Root Cause */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Root Cause:</p>
                  <p className="text-sm bg-muted p-3 rounded-lg">{diagnosis.rootCause}</p>
                </div>

                {/* Recommended Fix */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Recommended Fix:</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(diagnosis.recommendedFix)}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <div className="text-sm bg-muted p-3 rounded-lg whitespace-pre-wrap">
                    {diagnosis.recommendedFix}
                  </div>
                </div>

                {/* Code Snippet */}
                {diagnosis.codeSnippet && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">Code Fix:</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(diagnosis.codeSnippet!)}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy
                      </Button>
                    </div>
                    <pre className="text-xs bg-zinc-900 text-zinc-100 p-3 rounded-lg overflow-x-auto">
                      <code>{diagnosis.codeSnippet}</code>
                    </pre>
                  </div>
                )}

                {/* Auto-fix indicator */}
                {diagnosis.canAutoFix && (
                  <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
                    <p className="text-sm font-medium text-primary">
                      🤖 This error may be auto-fixable
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Action: {diagnosis.autoFixAction}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
