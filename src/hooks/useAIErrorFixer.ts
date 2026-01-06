import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DiagnosisResult {
  errorType: string;
  rootCause: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendedFix: string;
  codeSnippet?: string;
  canAutoFix: boolean;
  autoFixAction?: string;
}

interface ErrorDetails {
  message: string;
  type?: string;
  stackTrace?: string;
  url?: string;
  component?: string;
  metadata?: Record<string, any>;
}

export function useAIErrorFixer() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeError = useCallback(async (errorDetails: ErrorDetails): Promise<DiagnosisResult | null> => {
    setIsAnalyzing(true);
    setError(null);
    setDiagnosis(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('ai-error-fixer', {
        body: { error: errorDetails }
      });

      if (fnError) {
        throw fnError;
      }

      if (data?.error) {
        setError(data.error);
        // Still return the diagnosis if available
        if (data.diagnosis) {
          setDiagnosis(data.diagnosis);
          return data.diagnosis;
        }
        return null;
      }

      if (data?.diagnosis) {
        setDiagnosis(data.diagnosis);
        return data.diagnosis;
      }

      setError("No diagnosis received from AI");
      return null;

    } catch (err) {
      console.error("AI Error Fixer failed:", err);
      setError(err instanceof Error ? err.message : "Failed to analyze error");
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDiagnosis(null);
    setError(null);
    setIsAnalyzing(false);
  }, []);

  return {
    analyzeError,
    isAnalyzing,
    diagnosis,
    error,
    reset
  };
}
