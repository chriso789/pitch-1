import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

declare global {
  interface Window {
    fbq: (...args: any[]) => void;
    _fbq: any;
  }
}

/**
 * Reads a cookie value by name
 */
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Returns Facebook click id and browser id cookies for CAPI deduplication
 */
export function getFbCookies() {
  return {
    fbc: getCookie('_fbc'),
    fbp: getCookie('_fbp'),
  };
}

/**
 * Hook that initialises the Meta Pixel for the current tenant and exposes
 * a `trackEvent` helper that fires both browser-side fbq AND server-side CAPI
 * with the same event_id for deduplication.
 */
export function useMetaPixel() {
  const initializedPixelId = useRef<string | null>(null);

  // Load the pixel script once
  useEffect(() => {
    // Only inject the base fbq stub once
    if (typeof window.fbq === 'function') return;

    const f: any = function (...args: any[]) {
      f.callMethod ? f.callMethod(...args) : f.queue.push(args);
    };
    f.push = f;
    f.loaded = true;
    f.version = '2.0';
    f.queue = [];
    window.fbq = f;
    window._fbq = f;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }, []);

  // Initialise with the tenant's pixel id
  const initPixel = useCallback((pixelId: string) => {
    if (!pixelId || initializedPixelId.current === pixelId) return;
    if (typeof window.fbq !== 'function') return;

    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    initializedPixelId.current = pixelId;
    console.log('[MetaPixel] Initialized with pixel:', pixelId);
  }, []);

  /**
   * Fire an event both client-side (fbq) and server-side (CAPI).
   * Uses the same event_id for deduplication.
   */
  const trackEvent = useCallback(async (
    eventName: string,
    params: Record<string, any> = {},
    options?: {
      contactId?: string;
      tenantId?: string;
      value?: number;
      currency?: string;
    }
  ) => {
    const eventId = crypto.randomUUID();
    const { fbc, fbp } = getFbCookies();

    // 1. Browser-side pixel event
    if (typeof window.fbq === 'function' && initializedPixelId.current) {
      window.fbq('track', eventName, {
        ...params,
        value: options?.value,
        currency: options?.currency || 'USD',
      }, { eventID: eventId });
    }

    // 2. Server-side CAPI event (fire-and-forget)
    if (options?.tenantId) {
      supabase.functions.invoke('meta-capi', {
        body: {
          event_name: eventName,
          tenant_id: options.tenantId,
          contact_id: options.contactId || null,
          event_time: Math.floor(Date.now() / 1000),
          custom_data: {
            ...params,
            value: options.value,
            currency: options.currency || 'USD',
            event_id: eventId,
            fbc,
            fbp,
          },
        },
      }).catch((err) => console.warn('[MetaPixel] CAPI fire-and-forget error:', err));
    }
  }, []);

  return { initPixel, trackEvent, getFbCookies };
}
