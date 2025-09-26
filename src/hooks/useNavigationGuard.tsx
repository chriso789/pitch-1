import { useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

interface NavigationGuardOptions {
  hasUnsavedChanges?: boolean;
  message?: string;
  onConfirmNavigation?: () => void;
  onCancelNavigation?: () => void;
}

export const useNavigationGuard = ({
  hasUnsavedChanges = false,
  message = "You have unsaved changes. Are you sure you want to leave?",
  onConfirmNavigation,
  onCancelNavigation
}: NavigationGuardOptions = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isNavigationBlocked = useRef(false);
  const pendingLocation = useRef<string | null>(null);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (hasUnsavedChanges && !isNavigationBlocked.current) {
        // Prevent the navigation
        event.preventDefault();
        
        // Push current state back to history to stay on current page
        window.history.pushState(null, '', location.pathname + location.search);
        
        // Show confirmation
        const confirmed = window.confirm(message);
        
        if (confirmed) {
          isNavigationBlocked.current = true;
          onConfirmNavigation?.();
          // Navigate back after confirmation
          window.history.back();
        } else {
          onCancelNavigation?.();
          // Stay on current page - already handled by pushState above
        }
      }
    };

    // Add extra history entry to capture back button
    if (hasUnsavedChanges) {
      window.history.pushState(null, '', location.pathname + location.search);
    }

    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
      isNavigationBlocked.current = false;
    };
  }, [hasUnsavedChanges, message, location.pathname, location.search, onConfirmNavigation, onCancelNavigation]);

  // Handle programmatic navigation (Link clicks, navigate calls)
  const guardedNavigate = useCallback((to: string | number, options?: any) => {
    if (hasUnsavedChanges && typeof to === 'string') {
      const confirmed = window.confirm(message);
      
      if (confirmed) {
        onConfirmNavigation?.();
        isNavigationBlocked.current = true;
        navigate(to, options);
      } else {
        onCancelNavigation?.();
        return false;
      }
    } else {
      navigate(to as any, options);
    }
    return true;
  }, [hasUnsavedChanges, message, navigate, onConfirmNavigation, onCancelNavigation]);

  // Handle page refresh/close
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
    };

    if (hasUnsavedChanges) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, message]);

  const clearUnsavedChanges = useCallback(() => {
    isNavigationBlocked.current = false;
  }, []);

  return {
    guardedNavigate,
    clearUnsavedChanges,
    hasUnsavedChanges
  };
};