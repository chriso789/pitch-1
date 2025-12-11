import { useState, useEffect } from 'react';
import { CompanySwitchingOverlay } from './CompanySwitchingOverlay';

const SWITCHING_KEY = 'company-switching';

interface SwitchingData {
  companyName?: string;
  timestamp: number;
}

export const GlobalLoadingHandler = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [companyName, setCompanyName] = useState<string | undefined>();

  useEffect(() => {
    // Check for switching flag on mount
    const stored = localStorage.getItem(SWITCHING_KEY);
    if (stored) {
      try {
        const data: SwitchingData = JSON.parse(stored);
        // Only show if switch started within last 10 seconds (prevent stale overlays)
        if (Date.now() - data.timestamp < 10000) {
          setCompanyName(data.companyName);
          setIsLoading(true);
          
          // Fade out after a brief delay to let dashboard render
          const timer = setTimeout(() => {
            setIsLoading(false);
            localStorage.removeItem(SWITCHING_KEY);
          }, 600);
          
          return () => clearTimeout(timer);
        } else {
          // Stale flag, remove it
          localStorage.removeItem(SWITCHING_KEY);
        }
      } catch {
        localStorage.removeItem(SWITCHING_KEY);
      }
    }
  }, []);

  return <CompanySwitchingOverlay isVisible={isLoading} companyName={companyName} />;
};

// Helper to set the switching flag (used by useCompanySwitcher)
export const setSwitchingFlag = (companyName?: string) => {
  const data: SwitchingData = {
    companyName,
    timestamp: Date.now(),
  };
  localStorage.setItem(SWITCHING_KEY, JSON.stringify(data));
};
