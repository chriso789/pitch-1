/**
 * Frontend Performance Tracker
 * Phase 6: Monitoring & Alerts
 * 
 * Tracks key performance metrics and sends to backend for analysis.
 * Enables proactive identification of performance issues.
 */

import { supabase } from '@/integrations/supabase/client';

interface PerformanceMetric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  tenantId?: string;
}

// Buffer for batching metrics
const metricsBuffer: PerformanceMetric[] = [];
let flushTimeout: NodeJS.Timeout | null = null;

// Configuration
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL_MS = 10000; // 10 seconds

/**
 * Track a performance metric
 * 
 * @param name - Metric name (e.g., 'page_load_time', 'api_duration')
 * @param value - Metric value (usually milliseconds)
 * @param tags - Optional key-value tags for filtering
 */
export function trackMetric(
  name: string,
  value: number,
  tags?: Record<string, string>
): void {
  metricsBuffer.push({ name, value, tags });

  // Flush if buffer is full
  if (metricsBuffer.length >= BUFFER_SIZE) {
    flushMetrics();
  } else if (!flushTimeout) {
    // Schedule flush if not already scheduled
    flushTimeout = setTimeout(flushMetrics, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush buffered metrics to backend
 */
async function flushMetrics(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (metricsBuffer.length === 0) return;

  // Take metrics from buffer
  const metrics = metricsBuffer.splice(0, BUFFER_SIZE);

  try {
    await supabase.functions.invoke('log-performance-metric', {
      body: { metrics },
    });
  } catch (error) {
    console.error('[PerformanceTracker] Failed to flush metrics:', error);
    // Re-add to buffer on failure (with limit to prevent memory issues)
    if (metricsBuffer.length < 200) {
      metricsBuffer.unshift(...metrics);
    }
  }
}

/**
 * Track page load performance metrics
 */
export function trackPageLoad(pageName: string): void {
  if (typeof window === 'undefined') return;

  // Wait for page to fully load
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => trackPageLoad(pageName), { once: true });
    return;
  }

  const navigation = performance.getEntriesByType(
    'navigation'
  )[0] as PerformanceNavigationTiming;

  if (navigation) {
    trackMetric('page_load_time', navigation.loadEventEnd - navigation.startTime, {
      page: pageName,
    });
    trackMetric('dom_interactive', navigation.domInteractive - navigation.startTime, {
      page: pageName,
    });
    trackMetric('ttfb', navigation.responseStart - navigation.requestStart, {
      page: pageName,
    });
  }

  // Track First Contentful Paint
  const paintEntries = performance.getEntriesByType('paint');
  const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint');
  if (fcp) {
    trackMetric('first_contentful_paint', fcp.startTime, { page: pageName });
  }
}

/**
 * Track API call duration
 */
export function trackApiCall(
  endpoint: string,
  duration: number,
  success: boolean
): void {
  trackMetric('api_duration_ms', duration, {
    endpoint,
    success: String(success),
  });
}

/**
 * Track component render time
 */
export function trackRenderTime(componentName: string, duration: number): void {
  trackMetric('component_render_ms', duration, { component: componentName });
}

/**
 * Create a timing helper for measuring operations
 */
export function createTimer(): {
  stop: () => number;
  elapsed: () => number;
} {
  const start = performance.now();
  return {
    stop: () => performance.now() - start,
    elapsed: () => performance.now() - start,
  };
}

/**
 * Track memory usage (if available)
 */
export function trackMemoryUsage(): void {
  if (typeof window === 'undefined') return;

  const memory = (performance as any).memory;
  if (memory) {
    trackMetric('js_heap_size_mb', memory.usedJSHeapSize / 1048576);
    trackMetric('js_heap_limit_mb', memory.jsHeapSizeLimit / 1048576);
  }
}

/**
 * Decorator for tracking async function duration
 */
export function withTiming<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  metricName: string
): T {
  return (async (...args: Parameters<T>) => {
    const timer = createTimer();
    try {
      const result = await fn(...args);
      trackMetric(metricName, timer.stop(), { success: 'true' });
      return result;
    } catch (error) {
      trackMetric(metricName, timer.stop(), { success: 'false' });
      throw error;
    }
  }) as T;
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (metricsBuffer.length > 0) {
      // Use sendBeacon for reliable delivery on unload
      const blob = new Blob([JSON.stringify({ metrics: metricsBuffer })], {
        type: 'application/json',
      });
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-performance-metric`,
        blob
      );
    }
  });
}
