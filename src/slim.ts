/**
 * @youranalytics/web-sdk - Slim Build
 * Minimal analytics SDK (<3KB gzipped)
 * Only includes core tracking functionality
 */

import { Analytics } from './analytics';
import type { AnalyticsConfig } from './types';

// =============================================================================
// Exports (minimal set)
// =============================================================================

export { Analytics };
export type { AnalyticsConfig };

// =============================================================================
// Version
// =============================================================================

import { VERSION } from './version';
export { VERSION };

// =============================================================================
// Global API
// =============================================================================

/**
 * Global analytics interface for script tag usage.
 */
interface GlobalAnalytics {
  readonly version: string;
  instance: Analytics | null;
  init(apiKey: string, config?: Partial<Omit<AnalyticsConfig, 'apiKey'>>): Analytics;
  track(event: string, properties?: Record<string, unknown>): void;
  trackPageView(): void;
  flush(): Promise<void>;
  destroy(): void;
}

const globalAnalytics: GlobalAnalytics = {
  version: VERSION,
  instance: null,

  init(apiKey, config = {}) {
    if (this.instance) this.instance.destroy();
    this.instance = new Analytics({ apiKey, ...config });
    return this.instance;
  },

  track(event, properties = {}) {
    if (!this.instance) {
      console.warn('[Analytics] Not initialized');
      return;
    }
    this.instance.track(event, properties);
  },

  trackPageView() {
    this.instance?.trackPageView();
  },

  async flush() {
    if (this.instance) await this.instance.flush();
  },

  destroy() {
    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }
  },
};

// =============================================================================
// Auto-init from Script Tag
// =============================================================================

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).analytics = globalAnalytics;

  const script = document.currentScript as HTMLScriptElement | null;
  const apiKey = script?.getAttribute('data-api-key');

  if (apiKey) {
    globalAnalytics.init(apiKey, {
      endpoint: script?.getAttribute('data-endpoint') ?? undefined,
      debug: script?.getAttribute('data-debug') === 'true',
      autoTrack: script?.getAttribute('data-auto-track') !== 'false',
      adaptiveNetwork: script?.getAttribute('data-adaptive') !== 'false',
    });
  }
}

export default globalAnalytics;
