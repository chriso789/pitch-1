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
    // Priority 1: Use explicit navigation state if provided
    if (location.state?.from) {
      navigate(location.state.from);
      return;
    }
    
    // Priority 2: Check if we have any navigation key (React Router assigns these)
    // A key that's not "default" means we navigated here within the SPA
    const hasInternalNavigation = location.key && location.key !== 'default';
    
    if (hasInternalNavigation) {
      navigate(-1);
      return;
    }
    
    // Priority 3: No history - use fallback path with replace to prevent back-loop
    navigate(fallbackPath, { replace: true });
  }, [navigate, fallbackPath, location.state, location.key]);

  return {
    goBack
  };
};