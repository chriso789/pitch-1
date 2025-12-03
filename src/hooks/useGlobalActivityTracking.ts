import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { activityTracker } from '@/services/activityTracker';

/**
 * Global activity tracking hook that tracks:
 * - Page views on route changes
 * - Keystrokes across the entire application
 * - Button clicks (via event delegation)
 * 
 * Should be used at the app root level (App.tsx)
 */
export const useGlobalActivityTracking = () => {
  const location = useLocation();
  const keystrokeCount = useRef(0);
  const lastFlush = useRef(Date.now());

  // Track page views on route changes
  useEffect(() => {
    const pageName = getPageNameFromPath(location.pathname);
    activityTracker.trackPageView(location.pathname, pageName);
    console.log(`[ActivityTracking] Page view: ${location.pathname} (${pageName})`);
  }, [location.pathname]);

  // Track keystrokes globally
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip tracking for modifier keys alone
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
        return;
      }

      keystrokeCount.current++;
      activityTracker.trackKeystroke();

      // Log every 50 keystrokes or every 30 seconds
      const now = Date.now();
      if (keystrokeCount.current >= 50 || now - lastFlush.current > 30000) {
        console.log(`[ActivityTracking] Keystrokes batch: ${keystrokeCount.current}`);
        keystrokeCount.current = 0;
        lastFlush.current = now;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Track button clicks via event delegation
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Find if click was on a button or link
      const button = target.closest('button');
      const link = target.closest('a');
      
      if (button) {
        const buttonId = button.id || button.getAttribute('data-track-id') || 
                         button.textContent?.slice(0, 30) || 'unknown-button';
        activityTracker.trackButtonClick(buttonId, {
          className: button.className?.slice(0, 100),
          path: location.pathname,
        });
      } else if (link) {
        const linkId = link.id || link.getAttribute('data-track-id') || 
                       link.textContent?.slice(0, 30) || link.href?.slice(0, 50) || 'unknown-link';
        activityTracker.trackButtonClick(linkId, {
          type: 'link',
          href: link.href?.slice(0, 100),
          path: location.pathname,
        });
      }
    };

    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
  }, [location.pathname]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (keystrokeCount.current > 0) {
        console.log(`[ActivityTracking] Final flush: ${keystrokeCount.current} keystrokes`);
      }
    };
  }, []);
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
