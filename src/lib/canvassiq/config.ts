/**
 * CanvassIQ Configuration Manager
 * Manages and validates configuration for CanvassIQ services
 */

import { z } from 'zod';

// Configuration schema with Zod validation
const configSchema = z.object({
  // Supabase (from environment)
  supabaseUrl: z.string().url().optional(),
  supabaseAnonKey: z.string().min(1).optional(),
  
  // Feature flags
  enableFirecrawl: z.boolean().default(true),
  enableSearchBug: z.boolean().default(true),
  enableAutoDetect: z.boolean().default(true),
  
  // Rate limits
  enrichmentRateLimit: z.number().default(100), // per hour per user
  autoDetectRadius: z.number().default(0.5), // km
  maxPropertiesPerBatch: z.number().default(50),
  
  // Enrichment settings
  enrichmentConfidenceThreshold: z.number().min(0).max(100).default(70),
  firecrawlTimeout: z.number().default(30000), // ms
  searchBugFallbackEnabled: z.boolean().default(true),
  
  // Map settings
  defaultZoom: z.number().default(18),
  knockModeZoom: z.number().default(20),
  searchModeZoom: z.number().default(16),
  
  // Sync settings
  syncEnabled: z.boolean().default(true),
  syncRetryAttempts: z.number().default(3),
  syncRetryDelayMs: z.number().default(5000),
});

export type CanvassIQConfig = z.infer<typeof configSchema>;

// Default configuration
const defaultConfig: CanvassIQConfig = {
  enableFirecrawl: true,
  enableSearchBug: true,
  enableAutoDetect: true,
  enrichmentRateLimit: 100,
  autoDetectRadius: 0.5,
  maxPropertiesPerBatch: 50,
  enrichmentConfidenceThreshold: 70,
  firecrawlTimeout: 30000,
  searchBugFallbackEnabled: true,
  defaultZoom: 18,
  knockModeZoom: 20,
  searchModeZoom: 16,
  syncEnabled: true,
  syncRetryAttempts: 3,
  syncRetryDelayMs: 5000,
};

class ConfigManager {
  private config: CanvassIQConfig;
  private errors: string[] = [];
  private isValid: boolean = true;

  constructor() {
    this.config = { ...defaultConfig };
    this.loadFromEnvironment();
  }

  private loadFromEnvironment(): void {
    try {
      // Load Supabase config from meta env if available
      if (typeof window !== 'undefined') {
        const meta = (import.meta as any);
        if (meta?.env) {
          this.config.supabaseUrl = meta.env.VITE_SUPABASE_URL;
          this.config.supabaseAnonKey = meta.env.VITE_SUPABASE_ANON_KEY;
        }
      }
      
      // Validate the config
      const result = configSchema.safeParse(this.config);
      if (!result.success) {
        this.isValid = false;
        this.errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      }
    } catch (error) {
      this.isValid = false;
      this.errors.push(`Failed to load config: ${error}`);
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): CanvassIQConfig {
    return { ...this.config };
  }

  /**
   * Get a specific config value
   */
  get<K extends keyof CanvassIQConfig>(key: K): CanvassIQConfig[K] {
    return this.config[key];
  }

  /**
   * Update configuration values
   */
  update(partial: Partial<CanvassIQConfig>): void {
    const newConfig = { ...this.config, ...partial };
    const result = configSchema.safeParse(newConfig);
    
    if (result.success) {
      this.config = result.data;
      this.isValid = true;
      this.errors = [];
    } else {
      throw new Error(`Invalid config: ${result.error.errors.map(e => e.message).join(', ')}`);
    }
  }

  /**
   * Check if configuration is valid
   */
  isConfigValid(): boolean {
    return this.isValid;
  }

  /**
   * Get configuration validation errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Get redacted config for safe logging (hides sensitive values)
   */
  getRedactedConfig(): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(this.config)) {
      if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')) {
        redacted[key] = value ? '[REDACTED]' : undefined;
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }
}

// Singleton instance
export const configManager = new ConfigManager();

// Export convenience functions
export const isConfigValid = () => configManager.isConfigValid();
export const configErrors = () => configManager.getErrors();
export const getConfig = () => configManager.getConfig();
