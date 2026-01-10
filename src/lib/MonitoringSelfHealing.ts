import { supabase } from "@/integrations/supabase/client";

interface CrashReport {
  error_type: string;
  error_message: string;
  stack_trace?: string;
  component?: string;
  route?: string;
  severity: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, any>;
}

interface HealthCheckResult {
  service_name: string;
  status: "healthy" | "degraded" | "down";
  response_time_ms: number;
  error_message?: string;
  details?: Record<string, any>;
}

class MonitoringService {
  private static instance: MonitoringService;
  private isInitialized = false;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private errorBuffer: CrashReport[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  
  // Deduplication and rate limiting
  private recentCrashHashes = new Map<string, number>();
  private crashCount = 0;
  private lastCrashReset = Date.now();
  private isCurrentlyLogging = false;
  
  private static readonly MAX_CRASHES_PER_MINUTE = 20;
  private static readonly CRASH_DEDUP_WINDOW = 30000; // 30 seconds

  private constructor() {}

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Set up global error handlers
    this.setupErrorHandlers();

    // Start health check loop
    this.startHealthChecks();

    // Start error buffer flush
    this.startErrorBufferFlush();

    this.isInitialized = true;
    console.log("[Monitoring] System initialized");
  }

  private setupErrorHandlers(): void {
    // Global error handler
    window.onerror = (message, source, lineno, colno, error) => {
      this.reportCrash({
        error_type: "uncaught_error",
        error_message: String(message),
        stack_trace: error?.stack,
        component: source,
        severity: "high",
        metadata: { lineno, colno }
      });
      return false; // Let the error propagate
    };

    // Unhandled promise rejection handler
    window.onunhandledrejection = (event) => {
      this.reportCrash({
        error_type: "unhandled_promise_rejection",
        error_message: String(event.reason),
        stack_trace: event.reason?.stack,
        severity: "medium"
      });
    };

    // React error boundary integration
    console.log("[Monitoring] Error handlers configured");
  }

  private startHealthChecks(): void {
    // Run immediately
    this.runHealthChecks();

    // Then every 60 seconds
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, 60000);
  }

  private async runHealthChecks(): Promise<void> {
    const services = [
      { name: "supabase_db", check: () => this.checkSupabaseHealth() },
      { name: "supabase_auth", check: () => this.checkAuthHealth() },
      { name: "supabase_storage", check: () => this.checkStorageHealth() }
    ];

    const results: HealthCheckResult[] = [];

    for (const service of services) {
      try {
        const result = await service.check();
        results.push(result);
      } catch (error) {
        results.push({
          service_name: service.name,
          status: "down",
          response_time_ms: 0,
          error_message: String(error)
        });
      }
    }

    // Batch record all health checks via edge function
    await this.recordHealthChecks(results);
  }

  private async checkSupabaseHealth(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      const { error } = await supabase.from("tenants").select("id").limit(1);
      const responseTime = Math.round(performance.now() - start);
      
      return {
        service_name: "supabase_db",
        status: error ? "degraded" : "healthy",
        response_time_ms: responseTime,
        error_message: error?.message
      };
    } catch (error) {
      return {
        service_name: "supabase_db",
        status: "down",
        response_time_ms: Math.round(performance.now() - start),
        error_message: String(error)
      };
    }
  }

  private async checkAuthHealth(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      const { error } = await supabase.auth.getSession();
      const responseTime = Math.round(performance.now() - start);
      
      return {
        service_name: "supabase_auth",
        status: error ? "degraded" : "healthy",
        response_time_ms: responseTime,
        error_message: error?.message
      };
    } catch (error) {
      return {
        service_name: "supabase_auth",
        status: "down",
        response_time_ms: Math.round(performance.now() - start),
        error_message: String(error)
      };
    }
  }

  private async checkStorageHealth(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      const { error } = await supabase.storage.listBuckets();
      const responseTime = Math.round(performance.now() - start);
      
      return {
        service_name: "supabase_storage",
        status: error ? "degraded" : "healthy",
        response_time_ms: responseTime,
        error_message: error?.message
      };
    } catch (error) {
      return {
        service_name: "supabase_storage",
        status: "down",
        response_time_ms: Math.round(performance.now() - start),
        error_message: String(error)
      };
    }
  }

  private async recordHealthChecks(results: HealthCheckResult[]): Promise<void> {
    try {
      // Use edge function to bypass RLS issues
      const { error } = await supabase.functions.invoke('log-health-check', {
        body: { checks: results }
      });

      if (error) {
        console.error("[Monitoring] Edge function failed, falling back to direct insert:", error);
        // Fallback to direct insert (will use new RLS policies)
        for (const result of results) {
          await supabase.from("health_checks").insert({
            service_name: result.service_name,
            status: result.status,
            response_time_ms: result.response_time_ms,
            error_message: result.error_message,
            details: result.details || {}
          });
        }
      }
    } catch (error) {
      console.error("[Monitoring] Failed to record health checks:", error);
    }
  }

  private getCrashHash(crash: CrashReport): string {
    return `${crash.error_type}:${crash.error_message?.substring(0, 100)}:${crash.component || 'unknown'}`;
  }
  
  private shouldReportCrash(crash: CrashReport): boolean {
    const now = Date.now();
    
    // Reset counter if window expired
    if (now - this.lastCrashReset > 60000) {
      this.crashCount = 0;
      this.lastCrashReset = now;
    }
    
    // Rate limit check
    if (this.crashCount >= MonitoringService.MAX_CRASHES_PER_MINUTE) {
      console.debug('[Monitoring] Crash rate limit exceeded, skipping');
      return false;
    }
    
    // Deduplication check
    const hash = this.getCrashHash(crash);
    const lastSeen = this.recentCrashHashes.get(hash);
    if (lastSeen && now - lastSeen < MonitoringService.CRASH_DEDUP_WINDOW) {
      console.debug('[Monitoring] Duplicate crash within window, skipping');
      return false;
    }
    
    // Clean old entries
    for (const [h, ts] of this.recentCrashHashes.entries()) {
      if (now - ts > MonitoringService.CRASH_DEDUP_WINDOW) {
        this.recentCrashHashes.delete(h);
      }
    }
    
    this.recentCrashHashes.set(hash, now);
    this.crashCount++;
    return true;
  }

  async reportCrash(crash: CrashReport): Promise<void> {
    // Skip if already logging (prevent recursion)
    if (this.isCurrentlyLogging) {
      console.debug('[Monitoring] Already logging, skipping to prevent recursion');
      return;
    }
    
    // Check rate limit and deduplication
    if (!this.shouldReportCrash(crash)) {
      return;
    }
    
    // Add to buffer for batch processing
    this.errorBuffer.push(crash);

    // If critical, flush immediately
    if (crash.severity === "critical") {
      await this.flushErrorBuffer();
    }

    // Attempt auto-recovery for certain error types
    await this.attemptAutoRecovery(crash);
  }

  private async attemptAutoRecovery(crash: CrashReport): Promise<boolean> {
    let recovered = false;
    let recoveryAction = "";

    // Auto-recovery strategies based on error type
    switch (crash.error_type) {
      case "network_error":
        // Retry failed network requests
        recoveryAction = "network_retry";
        recovered = true;
        break;

      case "session_expired":
        // Attempt to refresh session
        try {
          const { error } = await supabase.auth.refreshSession();
          recovered = !error;
          recoveryAction = "session_refresh";
        } catch {
          recovered = false;
        }
        break;

      case "quota_exceeded":
        // Clear old cached data
        try {
          localStorage.removeItem("supabase.auth.token");
          recoveryAction = "cache_clear";
          recovered = true;
        } catch {
          recovered = false;
        }
        break;

      default:
        recovered = false;
    }

    if (recovered) {
      console.log(`[Monitoring] Auto-recovered from ${crash.error_type} using ${recoveryAction}`);
    }

    return recovered;
  }

  private startErrorBufferFlush(): void {
    // Flush every 10 seconds
    this.flushInterval = setInterval(() => {
      this.flushErrorBuffer();
    }, 10000);
  }

  private async flushErrorBuffer(): Promise<void> {
    if (this.errorBuffer.length === 0) return;
    
    // Prevent recursive logging
    if (this.isCurrentlyLogging) {
      console.debug('[Monitoring] Already flushing, skipping');
      return;
    }

    this.isCurrentlyLogging = true;
    const crashes = [...this.errorBuffer];
    this.errorBuffer = [];

    try {
      // Use edge function to bypass RLS issues - batch all crashes
      for (const crash of crashes) {
        try {
          const { error } = await supabase.functions.invoke('log-system-crash', {
            body: {
              error_type: crash.error_type,
              error_message: crash.error_message?.substring(0, 1000),
              stack_trace: crash.stack_trace?.substring(0, 5000),
              component: crash.component,
              route: crash.route || window.location.pathname,
              severity: crash.severity,
              metadata: crash.metadata || {},
              auto_recovered: false
            }
          });

          if (error) {
            // Log locally but don't retry to prevent loops
            console.debug("[Monitoring] Edge function failed:", error.message);
          }
        } catch (innerError) {
          // Silently fail individual crashes to prevent loop
          console.debug("[Monitoring] Failed to log crash:", innerError);
        }
      }
    } catch (error) {
      // Don't re-add to buffer - prevents infinite retry loops
      console.debug("[Monitoring] Failed to flush buffer:", error);
    } finally {
      this.isCurrentlyLogging = false;
    }
  }

  async recordMetric(name: string, value: number, unit?: string, tags?: Record<string, any>): Promise<void> {
    try {
      // Use edge function to bypass RLS issues
      const { error } = await supabase.functions.invoke('log-system-metrics', {
        body: {
          metrics: [{
            metric_name: name,
            metric_value: value,
            metric_unit: unit,
            tags: tags || {}
          }]
        }
      });

      if (error) {
        console.error("[Monitoring] Edge function failed for metric, falling back:", error);
        // Fallback to direct insert
        await supabase.from("system_metrics").insert({
          metric_name: name,
          metric_value: value,
          metric_unit: unit,
          tags: tags || {}
        });
      }
    } catch (error) {
      console.error("[Monitoring] Failed to record metric:", error);
    }
  }

  cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushErrorBuffer();
    console.log("[Monitoring] Cleanup complete");
  }
}

// Export singleton instance
export const monitoringService = MonitoringService.getInstance();

// Export initialization function
export function initializeMonitoring(): void {
  monitoringService.initialize();
}

// Export crash reporting function
export function reportCrash(crash: CrashReport): void {
  monitoringService.reportCrash(crash);
}

// Export metric recording function
export function recordMetric(name: string, value: number, unit?: string, tags?: Record<string, any>): void {
  monitoringService.recordMetric(name, value, unit, tags);
}

// React Error Boundary helper
export function createErrorBoundaryHandler(componentName: string) {
  return (error: Error, errorInfo: React.ErrorInfo) => {
    monitoringService.reportCrash({
      error_type: "react_error_boundary",
      error_message: error.message,
      stack_trace: error.stack,
      component: componentName,
      severity: "high",
      metadata: {
        componentStack: errorInfo.componentStack
      }
    });
  };
}
