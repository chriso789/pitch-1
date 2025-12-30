import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface BackButtonOptions {
  onBackPress?: () => void;
  preventDefaultBack?: boolean;
  fallbackPath?: string;
}

export const useBrowserBackButton = ({
  onBackPress,
  preventDefaultBack = false,
  fallbackPath = '/'
}: BackButtonOptions = {}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      if (onBackPress) {
        onBackPress();
      } else if (!preventDefaultBack) {
        // Default behavior - navigate to fallback path if no history
        const hasHistory = window.history.length > 1;
        if (!hasHistory) {
          navigate(fallbackPath);
        }
      }
    };

    // Listen for back button presses
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onBackPress, preventDefaultBack, fallbackPath, navigate]);

  // Custom back function that respects history
  const goBack = useCallback(() => {
    // Check if we have explicit state about where we came from
    if (location.state?.from) {
      navigate(location.state.from);
      return;
    }
    
    // Check if there's meaningful history (more than just the current page)
    // window.history.length > 2 because: 1 = blank, 2 = current page
    const hasHistory = window.history.length > 2;
    
    // Also check if referrer is from our own app
    let referrerIsOurApp = false;
    try {
      referrerIsOurApp = document.referrer && 
        new URL(document.referrer).origin === window.location.origin;
    } catch {
      // Invalid URL, ignore
    }
    
    if (hasHistory && referrerIsOurApp) {
      navigate(-1);
    } else {
      // No reliable history - use fallback path
      navigate(fallbackPath);
    }
  }, [navigate, fallbackPath, location.state]);

  return {
    goBack
  };
};