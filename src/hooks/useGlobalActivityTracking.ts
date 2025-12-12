import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { activityTracker } from '@/services/activityTracker';

// Enable activity tracking in all environments for debugging
const ENABLE_ACTIVITY_TRACKING = true;

/**
 * Global activity tracking hook that tracks:
 * - Page views on route changes
 * - Keystrokes (throttled/batched)
 * - Button clicks (debounced)
 * 
 * Optimized for performance with throttling and debouncing.
 * Should be used at the app root level (App.tsx)
 */
export const useGlobalActivityTracking = () => {
  const location = useLocation();
  const keystrokeCount = useRef(0);
  const lastFlush = useRef(Date.now());
  const lastClickTime = useRef(0);
  const clickDebounceMs = 300; // Debounce clicks by 300ms

  // Track page views on route changes
  useEffect(() => {
    if (!ENABLE_ACTIVITY_TRACKING) return;
    
    const pageName = getPageNameFromPath(location.pathname);
    activityTracker.trackPageView(location.pathname, pageName);
  }, [location.pathname]);

  // Throttled keystroke handler - only track batches, not individual keystrokes
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!ENABLE_ACTIVITY_TRACKING) return;
    
    // Skip tracking for modifier keys alone
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(event.key)) {
      return;
    }

    keystrokeCount.current++;

    // Only flush every 100 keystrokes or every 60 seconds (much less frequent)
    const now = Date.now();
    if (keystrokeCount.current >= 100 || now - lastFlush.current > 60000) {
      activityTracker.trackKeystroke();
      keystrokeCount.current = 0;
      lastFlush.current = now;
    }
  }, []);

  // Debounced click handler - only track actual interactive elements
  const handleClick = useCallback((event: MouseEvent) => {
    if (!ENABLE_ACTIVITY_TRACKING) return;
    
    const now = Date.now();
    // Debounce rapid clicks
    if (now - lastClickTime.current < clickDebounceMs) return;
    lastClickTime.current = now;

    const target = event.target as HTMLElement;
    
    // Only track actual interactive elements (buttons, links with meaningful actions)
    const button = target.closest('button');
    const link = target.closest('a[href]');
    
    if (button) {
      // Only track buttons with IDs or data-track-id (explicit tracking)
      const buttonId = button.id || button.getAttribute('data-track-id');
      if (buttonId) {
        activityTracker.trackButtonClick(buttonId, {
          path: location.pathname,
        });
      }
    } else if (link) {
      // Only track internal navigation links
      const href = link.getAttribute('href');
      if (href && href.startsWith('/')) {
        const linkId = link.id || link.getAttribute('data-track-id') || href;
        activityTracker.trackButtonClick(linkId, {
          type: 'link',
          path: location.pathname,
        });
      }
    }
  }, [location.pathname]);

  // Set up event listeners with passive option for better performance
  useEffect(() => {
    if (!ENABLE_ACTIVITY_TRACKING) return;

    document.addEventListener('keydown', handleKeyDown, { passive: true });
    document.addEventListener('click', handleClick, { capture: true, passive: true });
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick, { capture: true });
    };
  }, [handleKeyDown, handleClick]);
};

/**
 * Get a human-readable page name from a path
 */
function getPageNameFromPath(path: string): string {
  const pathMap: Record<string, string> = {
    '/': 'Landing Page',
    '/login': 'Login',
    '/signup': 'Sign Up',
    '/dashboard': 'Dashboard',
    '/pipeline': 'Sales Pipeline',
    '/production': 'Production',
    '/client-list': 'Client List',
    '/calendar': 'Calendar',
    '/storm-canvass': 'Storm Canvass Pro',
    '/dialer': 'Power Dialer',
    '/campaigns': 'Campaigns',
    '/smartdocs': 'Smart Docs',
    '/jobs': 'Jobs',
    '/estimates': 'Estimates',
    '/settings': 'Settings',
    '/help': 'Help',
    '/tasks': 'Tasks',
    '/reviews': 'Reviews',
    '/presentations': 'Presentations',
    '/material-orders': 'Material Orders',
    '/vendor-management': 'Vendor Management',
    '/price-management': 'Price Management',
    '/admin/companies': 'Company Administration',
  };

  // Check exact match first
  if (pathMap[path]) return pathMap[path];

  // Check for dynamic routes
  if (path.startsWith('/contact/')) return 'Contact Profile';
  if (path.startsWith('/lead/')) return 'Lead Details';
  if (path.startsWith('/job/')) return 'Job Details';
  if (path.startsWith('/project/')) return 'Project Details';
  if (path.startsWith('/storm-canvass/')) return 'Storm Canvass';
  if (path.startsWith('/presentations/')) return 'Presentation';
  if (path.startsWith('/material-orders/')) return 'Material Order Detail';
  if (path.startsWith('/roof-measure')) return 'Roof Measurement';
  if (path.startsWith('/templates/')) return 'Template Editor';

  // Default: capitalize the last segment
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0) {
    return segments[segments.length - 1]
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return 'Unknown Page';
}
