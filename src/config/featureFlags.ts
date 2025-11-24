/**
 * Feature Flags Configuration
 * 
 * Centralized feature toggles for production deployment.
 * Use environment variables or Supabase config for dynamic control.
 */

export interface FeatureFlags {
  // Mobile & Tablet Features
  ENABLE_MOBILE_OPTIMIZATION: boolean;
  ENABLE_TABLET_TOUCH_CONTROLS: boolean;
  ENABLE_HAPTIC_FEEDBACK: boolean;
  
  // Performance Features
  ENABLE_CANVAS_OBJECT_POOLING: boolean;
  ENABLE_PROGRESSIVE_IMAGE_LOADING: boolean;
  ENABLE_LAZY_LAYER_RENDERING: boolean;
  
  // Offline Features
  ENABLE_OFFLINE_QUEUE: boolean;
  ENABLE_OFFLINE_SYNC_RETRY: boolean;
  
  // Validation Features
  ENABLE_MEASUREMENT_VALIDATION: boolean;
  ENABLE_STRICT_VALIDATION: boolean; // Block save on validation errors
  
  // Limits
  MAX_FACET_COUNT: number;
  MAX_CACHE_SIZE_MB: number;
  MAX_MEASUREMENT_HISTORY_VERSIONS: number;
  
  // Debug
  ENABLE_DEBUG_LOGGING: boolean;
  ENABLE_PERFORMANCE_MONITORING: boolean;
}

// Default feature flag values
const DEFAULT_FLAGS: FeatureFlags = {
  // Mobile & Tablet Features
  ENABLE_MOBILE_OPTIMIZATION: true,
  ENABLE_TABLET_TOUCH_CONTROLS: true,
  ENABLE_HAPTIC_FEEDBACK: true,
  
  // Performance Features
  ENABLE_CANVAS_OBJECT_POOLING: true,
  ENABLE_PROGRESSIVE_IMAGE_LOADING: true,
  ENABLE_LAZY_LAYER_RENDERING: true,
  
  // Offline Features
  ENABLE_OFFLINE_QUEUE: true,
  ENABLE_OFFLINE_SYNC_RETRY: true,
  
  // Validation Features
  ENABLE_MEASUREMENT_VALIDATION: true,
  ENABLE_STRICT_VALIDATION: false, // Allow save with warnings by default
  
  // Limits
  MAX_FACET_COUNT: 50,
  MAX_CACHE_SIZE_MB: 50,
  MAX_MEASUREMENT_HISTORY_VERSIONS: 10,
  
  // Debug
  ENABLE_DEBUG_LOGGING: import.meta.env.DEV,
  ENABLE_PERFORMANCE_MONITORING: true,
};

// Override flags from environment variables if present
function getFeatureFlagsFromEnv(): Partial<FeatureFlags> {
  const flags: Partial<FeatureFlags> = {};
  
  // Check for environment variable overrides
  if (import.meta.env.VITE_ENABLE_MOBILE_OPTIMIZATION !== undefined) {
    flags.ENABLE_MOBILE_OPTIMIZATION = import.meta.env.VITE_ENABLE_MOBILE_OPTIMIZATION === 'true';
  }
  
  if (import.meta.env.VITE_ENABLE_OFFLINE_QUEUE !== undefined) {
    flags.ENABLE_OFFLINE_QUEUE = import.meta.env.VITE_ENABLE_OFFLINE_QUEUE === 'true';
  }
  
  if (import.meta.env.VITE_MAX_FACET_COUNT !== undefined) {
    flags.MAX_FACET_COUNT = parseInt(import.meta.env.VITE_MAX_FACET_COUNT, 10);
  }
  
  if (import.meta.env.VITE_MAX_CACHE_SIZE_MB !== undefined) {
    flags.MAX_CACHE_SIZE_MB = parseInt(import.meta.env.VITE_MAX_CACHE_SIZE_MB, 10);
  }
  
  return flags;
}

// Merge default flags with environment overrides
export const featureFlags: FeatureFlags = {
  ...DEFAULT_FLAGS,
  ...getFeatureFlagsFromEnv(),
};

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const value = featureFlags[feature];
  return typeof value === 'boolean' ? value : false;
}

/**
 * Get numeric feature limit
 */
export function getFeatureLimit(feature: keyof FeatureFlags): number {
  const value = featureFlags[feature];
  return typeof value === 'number' ? value : 0;
}

/**
 * Log feature flag status (debug only)
 */
export function logFeatureFlags() {
  if (!featureFlags.ENABLE_DEBUG_LOGGING) return;
  
  console.log('🚩 Feature Flags:', {
    mobile: {
      optimization: featureFlags.ENABLE_MOBILE_OPTIMIZATION,
      touchControls: featureFlags.ENABLE_TABLET_TOUCH_CONTROLS,
      hapticFeedback: featureFlags.ENABLE_HAPTIC_FEEDBACK,
    },
    performance: {
      objectPooling: featureFlags.ENABLE_CANVAS_OBJECT_POOLING,
      progressiveLoading: featureFlags.ENABLE_PROGRESSIVE_IMAGE_LOADING,
      lazyRendering: featureFlags.ENABLE_LAZY_LAYER_RENDERING,
    },
    offline: {
      queueEnabled: featureFlags.ENABLE_OFFLINE_QUEUE,
      autoRetry: featureFlags.ENABLE_OFFLINE_SYNC_RETRY,
    },
    validation: {
      enabled: featureFlags.ENABLE_MEASUREMENT_VALIDATION,
      strict: featureFlags.ENABLE_STRICT_VALIDATION,
    },
    limits: {
      maxFacets: featureFlags.MAX_FACET_COUNT,
      maxCacheMB: featureFlags.MAX_CACHE_SIZE_MB,
      maxHistoryVersions: featureFlags.MAX_MEASUREMENT_HISTORY_VERSIONS,
    },
  });
}

// Log on module load (dev only)
logFeatureFlags();
