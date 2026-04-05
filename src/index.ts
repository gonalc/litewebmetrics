/**
 * @youranalytics/web-sdk
 * Lightweight analytics SDK optimized for slow networks
 * @license MIT
 */

// =============================================================================
// Core Exports
// =============================================================================

// Export Analytics class (primary export)
export { Analytics, createAnalytics } from './analytics';

// Export all types
export type {
  AnalyticsConfig,
  ResolvedConfig,
  RawEvent,
  QueuedEvent,
  UtmParams,
  ConnectionType,
  NetworkInfo,
  EventBatch,
  AdaptiveSettings as AdaptiveSettingsType,
  SdkState,
  VisitorId,
  SessionId,
} from './types';

// Export type guards and utilities
export {
  isValidEvent,
  isValidConfig,
  isValidQueuedEvent,
  isValidUtmParams,
  createVisitorId,
  createSessionId,
  DEFAULT_CONFIG,
} from './types';

// Export storage utilities
export {
  generateId,
  getVisitorId,
  getSessionId,
  getItem,
  setItem,
  getSessionItem,
  setSessionItem,
  isStorageAvailable,
  resetStorageCache,
  clearVisitorId,
  clearSessionId,
  STORAGE_KEYS,
} from './storage';

// Export utility functions
export {
  // URL parsing
  parseQueryString,
  getUtmParams,
  // Network detection
  getConnectionInfo,
  getConnectionType,
  // Bot detection
  isBot,
  // Performance utilities
  debounce,
  throttle,
  // Browser compatibility
  supportsBeacon,
  supportsFetch,
  supportsCompression,
  resetCapabilityCache,
  // Data validation
  sanitizeEventName,
  sanitizeProperties,
  // Page context
  getPageUrl,
  getPageTitle,
  getReferrer,
  getUserAgent,
  getScreenDimensions,
} from './utils';

// Export network utilities
export {
  sendBeacon,
  sendFetch,
  sendWithRetry,
  send,
  queueOfflineEvents,
  getOfflineEvents,
  clearOfflineEvents,
  isOffline,
  onOnline,
  setDebugMode,
  NetworkError,
} from './network';

// Export network adapter for adaptive behavior
export {
  NetworkAdapter,
  RetryStrategy,
  EventPriority,
  sortByPriority,
  assignPriority,
  isDataSaverEnabled,
  getRtt,
  getDownlink,
  sendAdaptive,
  getNetworkAdapter,
  resetNetworkAdapter,
  type AdaptiveSettings,
  type BatchingStrategy,
  type PrioritizedEvent,
} from './network-adapter';

// =============================================================================
// Global API for Script Tag Usage
// =============================================================================

import { Analytics } from './analytics';
import type { AnalyticsConfig } from './types';

/**
 * Version of the SDK
 */
import { VERSION } from './version';
export { VERSION };

/**
 * Global analytics interface for script tag usage.
 * Provides a simple API that can be accessed via window.analytics
 */
export interface GlobalAnalytics {
  /** SDK version */
  readonly version: string;

  /** Current analytics instance (null if not initialized) */
  instance: Analytics | null;

  /**
   * Initialize the analytics SDK
   * @param apiKey - Your API key from the analytics dashboard
   * @param config - Optional configuration overrides
   * @returns The Analytics instance
   */
  init(apiKey: string, config?: Partial<Omit<AnalyticsConfig, 'apiKey'>>): Analytics;

  /**
   * Track a custom event
   * @param event - Event name
   * @param properties - Optional event properties
   */
  track(event: string, properties?: Record<string, unknown>): void;

  /**
   * Track a page view
   */
  trackPageView(): void;

  /**
   * Get the current visitor ID
   * @returns Visitor ID or null if not initialized
   */
  getVisitorId(): string | null;

  /**
   * Get the current session ID
   * @returns Session ID or null if not initialized
   */
  getSessionId(): string | null;

  /**
   * Manually flush queued events
   * @returns Promise that resolves when flush is complete
   */
  flush(): Promise<void>;

  /**
   * Destroy the analytics instance and clean up
   */
  destroy(): void;
}

/**
 * Create the global analytics object
 */
function createGlobalAnalytics(): GlobalAnalytics {
  return {
    version: VERSION,
    instance: null,

    init(apiKey: string, config: Partial<Omit<AnalyticsConfig, 'apiKey'>> = {}): Analytics {
      if (this.instance) {
        this.instance.destroy();
      }

      this.instance = new Analytics({ apiKey, ...config });
      return this.instance;
    },

    track(event: string, properties: Record<string, unknown> = {}): void {
      if (!this.instance) {
        if (typeof console !== 'undefined') {
          console.warn('[Analytics] Not initialized. Call analytics.init(apiKey) first.');
        }
        return;
      }
      this.instance.track(event, properties);
    },

    trackPageView(): void {
      if (!this.instance) {
        if (typeof console !== 'undefined') {
          console.warn('[Analytics] Not initialized. Call analytics.init(apiKey) first.');
        }
        return;
      }
      this.instance.trackPageView();
    },

    getVisitorId(): string | null {
      return this.instance?.getVisitorId() ?? null;
    },

    getSessionId(): string | null {
      return this.instance?.getSessionId() ?? null;
    },

    async flush(): Promise<void> {
      if (this.instance) {
        await this.instance.flush();
      }
    },

    destroy(): void {
      if (this.instance) {
        this.instance.destroy();
        this.instance = null;
      }
    },
  };
}

/**
 * Global analytics instance
 */
const globalAnalytics: GlobalAnalytics = createGlobalAnalytics();

// =============================================================================
// Auto-initialization from Script Tag
// =============================================================================

/**
 * Auto-initialize from script tag attributes.
 * Supports: data-api-key, data-endpoint, data-debug
 *
 * @example
 * <script src="analytics.min.js" data-api-key="pk_live_xxx"></script>
 *
 * @example With options
 * <script
 *   src="analytics.min.js"
 *   data-api-key="pk_live_xxx"
 *   data-endpoint="https://analytics.example.com"
 *   data-debug="true"
 * ></script>
 */
function autoInitFromScriptTag(): void {
  // Only run in browser environment
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // Expose global API
  (window as unknown as Record<string, unknown>).analytics = globalAnalytics;

  // Find the current script tag
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (!currentScript) {
    return;
  }

  // Check for data-api-key attribute
  const apiKey = currentScript.getAttribute('data-api-key');
  if (!apiKey) {
    return;
  }

  // Parse optional configuration from attributes
  const endpoint = currentScript.getAttribute('data-endpoint') ?? undefined;
  const debug = currentScript.getAttribute('data-debug') === 'true';
  const autoTrack = currentScript.getAttribute('data-auto-track') !== 'false';
  const adaptiveNetwork = currentScript.getAttribute('data-adaptive') !== 'false';

  globalAnalytics.init(apiKey, {
    endpoint,
    debug,
    autoTrack,
    adaptiveNetwork,
  });
}

// Run auto-initialization
autoInitFromScriptTag();

// =============================================================================
// Default Export
// =============================================================================

/**
 * Default export is the global analytics object.
 * Can be used as: import analytics from '@youranalytics/web-sdk'
 */
export default globalAnalytics;
