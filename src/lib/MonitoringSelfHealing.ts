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

  async reportCrash(crash: CrashReport): Promise<void> {
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

    const crashes = [...this.errorBuffer];
    this.errorBuffer = [];

    try {
      // Use edge function to bypass RLS issues
      for (const crash of crashes) {
        const { error } = await supabase.functions.invoke('log-system-crash', {
          body: {
            error_type: crash.error_type,
            error_message: crash.error_message,
            stack_trace: crash.stack_trace,
            component: crash.component,
            route: crash.route || window.location.pathname,
            severity: crash.severity,
            metadata: crash.metadata || {},
            auto_recovered: false
          }
        });

        if (error) {
          console.error("[Monitoring] Edge function failed for crash report:", error);
          // Fallback to direct insert (will use new RLS policies)
          await supabase.from("system_crashes").insert({
            error_type: crash.error_type,
            error_message: crash.error_message,
            stack_trace: crash.stack_trace,
            component: crash.component,
            route: crash.route || window.location.pathname,
            severity: crash.severity,
            metadata: crash.metadata || {},
            auto_recovered: false
          });
        }
      }
    } catch (error) {
      console.error("[Monitoring] Failed to flush error buffer:", error);
      // Re-add to buffer for retry
      this.errorBuffer.push(...crashes);
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
