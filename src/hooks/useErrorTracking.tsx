import React, { createContext, useContext, useEffect, useState } from 'react';
import { errorTracker, RuntimeError } from '@/services/errorTrackingService';
import { scrubberReportService, ScrubberIssue } from '@/services/scrubberReportService';

interface ErrorTrackingContextType {
  runtimeErrors: RuntimeError[];
  scrubberIssues: ScrubberIssue[];
  trackButtonClick: (element: HTMLElement, outcome: 'success' | 'error' | 'no_action', details?: string) => void;
  trackNavigationFailure: (targetUrl: string, error: string) => void;
  updateRuntimeError: (errorId: string, status: RuntimeError['status'], fixNotes?: string) => void;
  updateScrubberIssue: (issueId: string, status: ScrubberIssue['status'], fixNotes?: string) => void;
  refreshScrubberReport: () => Promise<void>;
  errorStats: {
    runtime: { total: number; open: number; resolved: number; critical: number };
    scrubber: { total: number; open: number; resolved: number; dynamic: number; static: number };
  };
}

const ErrorTrackingContext = createContext<ErrorTrackingContextType | undefined>(undefined);

export const ErrorTrackingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [runtimeErrors, setRuntimeErrors] = useState<RuntimeError[]>([]);
  const [scrubberIssues, setScrubberIssues] = useState<ScrubberIssue[]>([]);

  useEffect(() => {
    // Subscribe to runtime errors
    const unsubscribeRuntime = errorTracker.subscribe(setRuntimeErrors);
    
    // Subscribe to scrubber issues
    const unsubscribeScrubber = scrubberReportService.subscribe(setScrubberIssues);
    
    // Load initial data
    setRuntimeErrors(errorTracker.getErrors());
    setScrubberIssues(scrubberReportService.getIssues());
    
    // Try to load scrubber report
    scrubberReportService.loadScrubberReport();

    return () => {
      unsubscribeRuntime();
      unsubscribeScrubber();
    };
  }, []);

  const trackButtonClick = (element: HTMLElement, outcome: 'success' | 'error' | 'no_action', details?: string) => {
    errorTracker.trackButtonClick(element, outcome, details);
  };

  const trackNavigationFailure = (targetUrl: string, error: string) => {
    errorTracker.trackNavigationFailure(targetUrl, error);
  };

  const updateRuntimeError = (errorId: string, status: RuntimeError['status'], fixNotes?: string) => {
    errorTracker.updateErrorStatus(errorId, status, fixNotes);
  };

  const updateScrubberIssue = (issueId: string, status: ScrubberIssue['status'], fixNotes?: string) => {
    scrubberReportService.updateIssueStatus(issueId, status, fixNotes);
  };

  const refreshScrubberReport = async () => {
    await scrubberReportService.loadScrubberReport();
  };

  const errorStats = {
    runtime: errorTracker.getErrorStats(),
    scrubber: scrubberReportService.getIssueStats()
  };

  return (
    <ErrorTrackingContext.Provider value={{
      runtimeErrors,
      scrubberIssues,
      trackButtonClick,
      trackNavigationFailure,
      updateRuntimeError,
      updateScrubberIssue,
      refreshScrubberReport,
      errorStats
    }}>
      {children}
    </ErrorTrackingContext.Provider>
  );
};

export const useErrorTracking = () => {
  const context = useContext(ErrorTrackingContext);
  if (context === undefined) {
    throw new Error('useErrorTracking must be used within an ErrorTrackingProvider');
  }
  return context;
};

// Hook for individual components to track their button clicks
export const useButtonTracker = () => {
  const { trackButtonClick } = useErrorTracking();
  
  const trackClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    const element = event.currentTarget;
    
    // Set a timeout to check if any action occurred
    setTimeout(() => {
      // This is a simple heuristic - in a real app you might want more sophisticated tracking
      const hasToastError = document.querySelector('[data-sonner-toast][data-type="error"]');
      const hasConsoleErrors = performance.getEntriesByType('navigation').length > 0;
      
      if (hasToastError) {
        trackButtonClick(element, 'error', 'Error toast displayed after click');
      } else {
        // For now, assume success unless we detect errors
        trackButtonClick(element, 'success');
      }
    }, 100);
  }, [trackButtonClick]);
  
  return { trackClick };
};