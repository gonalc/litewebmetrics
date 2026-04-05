/**
 * @youranalytics/web-sdk — Production Entry Point
 * Minimal exports for IIFE bundles (no test utilities or unused code)
 */

// Core exports
export { Analytics, createAnalytics } from './analytics';
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
export { DEFAULT_CONFIG } from './types';

// Version
import { VERSION } from './version';
export { VERSION };

// =============================================================================
// Global API for Script Tag Usage
// =============================================================================

import { Analytics } from './analytics';
import type { AnalyticsConfig } from './types';

interface GlobalAnalytics {
  readonly version: string;
  instance: Analytics | null;
  init(apiKey: string, config?: Partial<Omit<AnalyticsConfig, 'apiKey'>>): Analytics;
  track(event: string, properties?: Record<string, unknown>): void;
  trackPageView(): void;
  getVisitorId(): string | null;
  getSessionId(): string | null;
  flush(): Promise<void>;
  destroy(): void;
}

const globalAnalytics: GlobalAnalytics = {
  version: VERSION,
  instance: null,

  init(apiKey: string, config: Partial<Omit<AnalyticsConfig, 'apiKey'>> = {}): Analytics {
    if (this.instance) this.instance.destroy();
    this.instance = new Analytics({ apiKey, ...config });
    return this.instance;
  },

  track(event: string, properties: Record<string, unknown> = {}): void {
    if (!this.instance) {
      if (typeof console !== 'undefined') console.warn('[Analytics] Not initialized. Call analytics.init(apiKey) first.');
      return;
    }
    this.instance.track(event, properties);
  },

  trackPageView(): void {
    if (!this.instance) {
      if (typeof console !== 'undefined') console.warn('[Analytics] Not initialized. Call analytics.init(apiKey) first.');
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
    if (this.instance) await this.instance.flush();
  },

  destroy(): void {
    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }
  },
};

// Auto-initialization from Script Tag
function autoInitFromScriptTag(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  (window as unknown as Record<string, unknown>).analytics = globalAnalytics;

  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (!currentScript) return;

  const apiKey = currentScript.getAttribute('data-api-key');
  if (!apiKey) return;

  globalAnalytics.init(apiKey, {
    endpoint: currentScript.getAttribute('data-endpoint') ?? undefined,
    debug: currentScript.getAttribute('data-debug') === 'true',
    autoTrack: currentScript.getAttribute('data-auto-track') !== 'false',
    adaptiveNetwork: currentScript.getAttribute('data-adaptive') !== 'false',
  });
}

autoInitFromScriptTag();

export default globalAnalytics;
