/**
 * Page Tracking Hook
 * Auto-tracks PAGE_VIEW and SCROLL_DEPTH events
 */

import { useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { trackingService } from './trackingService';

export function usePageTracking() {
  const location = useLocation();

  // Track page views on route change
  useEffect(() => {
    trackingService.trackPageView(location.pathname);
  }, [location.pathname]);

  // Track scroll depth
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
      trackingService.trackScrollDepth(scrollPercent);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]);

  // CTA click tracking helper
  const trackCTAClick = useCallback((elementId: string, elementText?: string, metadata?: Record<string, any>) => {
    trackingService.trackCTAClick(elementId, elementText, metadata);
  }, []);

  // Form submit tracking helper
  const trackFormSubmit = useCallback((formType: string, metadata?: Record<string, any>) => {
    trackingService.trackFormSubmit(formType, metadata);
  }, []);

  return {
    trackCTAClick,
    trackFormSubmit
  };
}

/**
 * Marketing site specific tracking hook
 * For use on landing page and public marketing pages
 */
export function useMarketingTracking() {
  const { trackCTAClick, trackFormSubmit } = usePageTracking();

  // Pre-defined CTA tracking functions for common buttons
  const trackHeroBookDemo = () => trackCTAClick('hero_book_demo', 'Book a Demo');
  const trackHeroStartTrial = () => trackCTAClick('hero_start_trial', 'Start Free Trial');
  const trackNavLogin = () => trackCTAClick('nav_login', 'Login');
  const trackNavSignup = () => trackCTAClick('nav_signup', 'Sign Up');
  const trackPricingCTA = (plan: string) => trackCTAClick(`pricing_${plan}`, `Get Started - ${plan}`);
  const trackFeatureCTA = (feature: string) => trackCTAClick(`feature_${feature}`, `Learn More - ${feature}`);
  const trackFooterCTA = (action: string) => trackCTAClick(`footer_${action}`, action);

  // Form tracking
  const trackDemoRequest = (metadata?: Record<string, any>) => trackFormSubmit('demo_request', metadata);
  const trackNewsletterSignup = (metadata?: Record<string, any>) => trackFormSubmit('newsletter', metadata);
  const trackContactForm = (metadata?: Record<string, any>) => trackFormSubmit('contact', metadata);

  return {
    trackCTAClick,
    trackFormSubmit,
    trackHeroBookDemo,
    trackHeroStartTrial,
    trackNavLogin,
    trackNavSignup,
    trackPricingCTA,
    trackFeatureCTA,
    trackFooterCTA,
    trackDemoRequest,
    trackNewsletterSignup,
    trackContactForm
  };
}
