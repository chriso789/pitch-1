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
    // Check if we have location state indicating where we came from
    if (location.state?.from) {
      navigate(location.state.from);
    } else {
      // Use navigate(-1) which is more reliable than window.history.back()
      // It will navigate to the previous entry in the history stack
      try {
        navigate(-1);
      } catch {
        // Fallback if navigate(-1) fails
        navigate(fallbackPath);
      }
    }
  }, [navigate, fallbackPath, location.state]);

  return {
    goBack
  };
};