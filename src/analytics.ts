/**
 * @youranalytics/web-sdk Analytics Class
 * Core SDK class that orchestrates storage, network, and event tracking
 */

// Injected at build time
declare const ANALYTICS_ENDPOINT: string;
declare const __DEBUG__: boolean;

import type {
  AnalyticsConfig,
  ResolvedConfig,
  VisitorId,
  SessionId,
  RawEvent,
  QueuedEvent,
  EventBatch,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { getVisitorId, getSessionId } from './storage';
import {
  isBot,
  sanitizeEventName,
  sanitizeProperties,
  getPageUrl,
  getPageTitle,
  getReferrer,
  getUserAgent,
  getScreenDimensions,
  getUtmParams,
  debounce,
} from './utils';
import {
  sendBeacon,
  sendFetch,
  queueOfflineEvents,
  getOfflineEvents,
  clearOfflineEvents,
  isOffline,
  setDebugMode,
} from './network';
import {
  NetworkAdapter,
  sendAdaptive,
  type AdaptiveSettings,
} from './network-adapter';

// =============================================================================
// Constants
// =============================================================================

/** Debounce time for pageview events to prevent double-tracking (ms) */
const PAGEVIEW_DEBOUNCE_MS = 100;

// =============================================================================
// Analytics Class
// =============================================================================

/**
 * Main Analytics SDK class.
 * Manages event tracking, queue, and communication with the analytics server.
 *
 * @example
 * ```typescript
 * const analytics = new Analytics({ apiKey: 'pk_live_xxx' });
 *
 * // Track custom events
 * analytics.track('signup', { plan: 'pro' });
 *
 * // Track page views (usually automatic)
 * analytics.trackPageView();
 *
 * // Clean up when done
 * analytics.destroy();
 * ```
 */
export class Analytics {
  private config: ResolvedConfig;
  private queue: QueuedEvent[] = [];
  private visitorId: VisitorId;
  private sessionId: SessionId;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;
  private lastPageUrl = '';

  // Bound event handlers (for cleanup)
  private boundHandlePageUnload: () => void;
  private boundHandleOnline: () => void;
  private boundHandleOffline: () => void;
  private boundHandlePopstate: () => void;

  // Debounced pageview tracker
  private debouncedTrackPageView: () => void;

  // Original history methods (for restoration)
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;

  // Network adapter for adaptive behavior
  private adapter: NetworkAdapter | null = null;
  private adapterCleanup: (() => void) | null = null;
  private useAdaptiveNetwork: boolean;

  /**
   * Create a new Analytics instance.
   *
   * @param config - Analytics configuration
   * @throws Error if API key is missing
   */
  constructor(config: AnalyticsConfig) {
    // 1. Validate API key
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw new Error('[Analytics] API key is required');
    }

    // 2. Merge config with defaults
    this.config = {
      apiKey: config.apiKey,
      endpoint: config.endpoint ?? ANALYTICS_ENDPOINT,
      debug: config.debug ?? DEFAULT_CONFIG.debug,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize,
      flushInterval: config.flushInterval ?? DEFAULT_CONFIG.flushInterval,
      autoTrack: config.autoTrack ?? DEFAULT_CONFIG.autoTrack,
      adaptiveNetwork: config.adaptiveNetwork ?? DEFAULT_CONFIG.adaptiveNetwork,
    };

    // Set debug mode for network module
    setDebugMode(this.config.debug);

    // 3. Get/create visitor and session IDs
    this.visitorId = getVisitorId();
    this.sessionId = getSessionId();

    // 4. Initialize bound handlers
    this.boundHandlePageUnload = this.handlePageUnload.bind(this);
    this.boundHandleOnline = this.handleOnline.bind(this);
    this.boundHandleOffline = this.handleOffline.bind(this);
    this.boundHandlePopstate = this.handlePopstate.bind(this);

    // Create debounced pageview tracker
    this.debouncedTrackPageView = debounce(() => {
      this.trackPageViewInternal();
    }, PAGEVIEW_DEBOUNCE_MS);

    // 5. Initialize network adapter for adaptive behavior
    this.useAdaptiveNetwork = this.config.adaptiveNetwork;
    if (this.useAdaptiveNetwork) {
      this.initNetworkAdapter();
    }

    // 6. Check if bot (skip init if bot)
    if (isBot()) {
      this.log('Bot detected, skipping initialization');
      return;
    }

    // 6. Initialize tracking
    this.init();
  }

  /**
   * Set up auto-tracking, timers, and event listeners.
   */
  private init(): void {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    this.lastPageUrl = getPageUrl();

    // 1. Track initial pageview (if autoTrack enabled)
    if (this.config.autoTrack) {
      this.trackPageViewInternal();
    }

    // 2. Set up SPA navigation tracking
    if (this.config.autoTrack) {
      this.setupPageViewTracking();
    }

    // 3. Start flush timer
    this.startFlushTimer();

    // 4. Add beforeunload listener (flush on page exit)
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.boundHandlePageUnload);

      // 5. Add online/offline listeners
      window.addEventListener('online', this.boundHandleOnline);
      window.addEventListener('offline', this.boundHandleOffline);
    }

    // 6. Send any queued offline events
    this.sendOfflineEvents();

    this.log('Initialized successfully');
  }

  /**
   * Initialize the network adapter for adaptive behavior.
   */
  private initNetworkAdapter(): void {
    if (!this.useAdaptiveNetwork) {
      return;
    }

    try {
      this.adapter = new NetworkAdapter();

      // Apply initial adaptive settings
      this.applyAdaptiveSettings(this.adapter.getSettings());

      // Listen for connection changes
      this.adapterCleanup = this.adapter.onConnectionChange((settings) => {
        this.applyAdaptiveSettings(settings);
      });
    } catch (error) {
      // If adapter fails, continue without adaptive behavior
      this.warn('Failed to initialize network adapter', error);
      this.adapter = null;
    }
  }

  /**
   * Apply adaptive settings based on network conditions.
   */
  private applyAdaptiveSettings(settings: AdaptiveSettings): void {
    const oldFlushInterval = this.config.flushInterval;

    // Update config with adaptive values
    this.config = {
      ...this.config,
      maxQueueSize: settings.maxQueueSize,
      flushInterval: settings.flushInterval,
    };

    // Restart timer if interval changed
    if (settings.flushInterval !== oldFlushInterval && this.isInitialized) {
      this.stopFlushTimer();
      this.startFlushTimer();
    }

    this.log('Adapted to network conditions:', settings);
  }

  // ===========================================================================
  // Event Tracking
  // ===========================================================================

  /**
   * Track a custom event.
   *
   * @param eventName - Name of the event (will be sanitized)
   * @param properties - Optional event properties
   *
   * @example
   * ```typescript
   * analytics.track('purchase', {
   *   product_id: '123',
   *   price: 99.99,
   *   currency: 'USD',
   * });
   * ```
   */
  public track(
    eventName: string,
    properties: Record<string, unknown> = {}
  ): void {
    if (!this.isInitialized) {
      this.warn('SDK not initialized, event not tracked');
      return;
    }

    try {
      // 1. Sanitize event name
      const sanitizedName = sanitizeEventName(eventName);

      // 2. Sanitize properties
      const sanitizedProps = sanitizeProperties(properties);

      // 3. Create QueuedEvent
      const queuedEvent: QueuedEvent = {
        event: sanitizedName,
        properties: sanitizedProps,
        timestamp: Date.now(),
      };

      // 4. Add to queue
      this.queue.push(queuedEvent);

      this.log(`Tracked event: ${sanitizedName}`, sanitizedProps);

      // 5. Flush if queue >= maxQueueSize
      if (this.queue.length >= this.config.maxQueueSize) {
        this.flush();
      }
    } catch (error) {
      this.error('Failed to track event', error);
    }
  }

  /**
   * Track a page view event.
   * Convenience method that calls track('pageview', {}).
   */
  public trackPageView(): void {
    this.debouncedTrackPageView();
  }

  /**
   * Internal pageview tracking (not debounced).
   */
  private trackPageViewInternal(): void {
    const currentUrl = getPageUrl();

    // Prevent duplicate pageviews for same URL
    if (currentUrl === this.lastPageUrl && this.queue.length > 0) {
      const lastEvent = this.queue[this.queue.length - 1];
      if (lastEvent.event === 'pageview') {
        return;
      }
    }

    this.lastPageUrl = currentUrl;
    this.track('pageview', {});
  }

  // ===========================================================================
  // Queue Management
  // ===========================================================================

  /**
   * Send all queued events to the server.
   * Uses sendBeacon first, falls back to fetch.
   *
   * @returns Promise that resolves when flush is complete
   */
  public async flush(): Promise<void> {
    // 1. Check if queue is empty
    if (this.queue.length === 0) {
      return;
    }

    // 2. Take all events from queue (swap with empty array)
    const eventsToSend = this.queue;
    this.queue = [];

    // 3. Convert QueuedEvents to RawEvents with full metadata
    const rawEvents = this.buildRawEvents(eventsToSend);

    // 4. Create EventBatch
    const batch: EventBatch = {
      api_key: this.config.apiKey,
      events: rawEvents,
    };

    const endpoint = `${this.config.endpoint}/events`;

    // 5. Check offline state
    if (isOffline()) {
      this.log('Offline, queuing events for later');
      queueOfflineEvents(rawEvents);
      return;
    }

    try {
      // 6. Use adaptive sending if adapter available
      if (this.adapter) {
        await sendAdaptive(endpoint, batch, this.adapter);
        this.log(`Flushed ${rawEvents.length} events via adaptive send`);
        return;
      }

      // 7. Fallback: Try sendBeacon first
      if (sendBeacon(endpoint, batch)) {
        this.log(`Flushed ${rawEvents.length} events via beacon`);
        return;
      }

      // 8. If sendBeacon fails/unavailable, use fetch
      await sendFetch(endpoint, batch);
      this.log(`Flushed ${rawEvents.length} events via fetch`);
    } catch (error) {
      // 9. If offline or network error, queue events in localStorage
      this.error('Failed to send events, queuing for retry', error);
      queueOfflineEvents(rawEvents);
    }
  }

  /**
   * Build RawEvents from QueuedEvents by adding context metadata.
   */
  private buildRawEvents(queuedEvents: QueuedEvent[]): RawEvent[] {
    const pageUrl = getPageUrl();
    const pageTitle = getPageTitle();
    const referrer = getReferrer();
    const userAgent = getUserAgent();
    const screen = getScreenDimensions();
    const utm = getUtmParams();

    return queuedEvents.map((queued) => ({
      event: queued.event,
      properties: queued.properties,
      timestamp: queued.timestamp,
      visitor_id: this.visitorId,
      session_id: this.sessionId,
      page_url: pageUrl,
      page_title: pageTitle,
      referrer: referrer,
      user_agent: userAgent,
      screen_width: screen.width,
      screen_height: screen.height,
      ...(Object.keys(utm).length > 0 && { utm }),
    }));
  }

  /**
   * Start periodic flush timer.
   */
  private startFlushTimer(): void {
    if (this.flushTimer !== null) {
      return;
    }

    if (this.config.flushInterval <= 0) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);

    this.log(`Started flush timer: ${this.config.flushInterval}ms`);
  }

  /**
   * Stop flush timer.
   */
  private stopFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.log('Stopped flush timer');
    }
  }

  // ===========================================================================
  // Auto-Tracking Setup
  // ===========================================================================

  /**
   * Set up automatic page view tracking for SPAs.
   * Wraps history methods and listens to popstate.
   */
  private setupPageViewTracking(): void {
    if (typeof window === 'undefined' || typeof history === 'undefined') {
      return;
    }

    // Wrap history.pushState
    this.wrapHistoryMethod('pushState');

    // Wrap history.replaceState
    this.wrapHistoryMethod('replaceState');

    // Listen to popstate (back/forward navigation)
    window.addEventListener('popstate', this.boundHandlePopstate);

    this.log('Set up SPA navigation tracking');
  }

  /**
   * Wrap history method to track navigation.
   */
  private wrapHistoryMethod(method: 'pushState' | 'replaceState'): void {
    if (typeof history === 'undefined') {
      return;
    }

    const original = history[method];
    if (!original) {
      return;
    }

    // Store original for restoration
    if (method === 'pushState') {
      this.originalPushState = original;
    } else {
      this.originalReplaceState = original;
    }

    // Create reference to this for closure
    const analytics = this;

    // Replace with wrapped version
    history[method] = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      // Call original method
      const result = original.apply(this, [data, unused, url]);

      // Track pageview after navigation
      analytics.trackPageView();

      return result;
    };
  }

  /**
   * Handle popstate event (back/forward navigation).
   */
  private handlePopstate = (): void => {
    this.trackPageView();
  };

  /**
   * Restore original history methods.
   */
  private restoreHistoryMethods(): void {
    if (typeof history === 'undefined') {
      return;
    }

    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }

    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Handle page unload - flush remaining events.
   * Must use sendBeacon for reliability.
   */
  private handlePageUnload = (): void => {
    if (this.queue.length === 0) {
      return;
    }

    const rawEvents = this.buildRawEvents(this.queue);
    const batch: EventBatch = {
      api_key: this.config.apiKey,
      events: rawEvents,
    };

    const endpoint = `${this.config.endpoint}/events`;

    // Use sendBeacon for page unload (synchronous-like behavior)
    if (!sendBeacon(endpoint, batch)) {
      // If beacon fails, queue for offline
      queueOfflineEvents(rawEvents);
    }

    this.queue = [];
  };

  /**
   * Handle coming back online.
   * Send any queued offline events.
   */
  private handleOnline = (): void => {
    this.log('Back online, sending queued events');
    this.sendOfflineEvents();
  };

  /**
   * Handle going offline.
   * Flush current queue to localStorage.
   */
  private handleOffline = (): void => {
    this.log('Gone offline, queuing events');
    if (this.queue.length > 0) {
      const rawEvents = this.buildRawEvents(this.queue);
      queueOfflineEvents(rawEvents);
      this.queue = [];
    }
  };

  /**
   * Send any queued offline events.
   */
  private sendOfflineEvents(): void {
    const offlineEvents = getOfflineEvents();

    if (offlineEvents.length === 0) {
      return;
    }

    this.log(`Found ${offlineEvents.length} offline events to send`);

    // Clear offline storage first
    clearOfflineEvents();

    // Create batch and send
    const batch: EventBatch = {
      api_key: this.config.apiKey,
      events: offlineEvents,
    };

    const endpoint = `${this.config.endpoint}/events`;

    // Try to send
    if (!sendBeacon(endpoint, batch)) {
      // Fall back to fetch
      sendFetch(endpoint, batch).catch((error) => {
        this.error('Failed to send offline events', error);
        // Re-queue on failure
        queueOfflineEvents(offlineEvents);
      });
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Update configuration at runtime.
   *
   * @param updates - Partial configuration to merge
   */
  public setConfig(updates: Partial<AnalyticsConfig>): void {
    const oldFlushInterval = this.config.flushInterval;

    // Merge updates
    this.config = {
      ...this.config,
      ...(updates.endpoint !== undefined && { endpoint: updates.endpoint }),
      ...(updates.debug !== undefined && { debug: updates.debug }),
      ...(updates.maxQueueSize !== undefined && {
        maxQueueSize: updates.maxQueueSize,
      }),
      ...(updates.flushInterval !== undefined && {
        flushInterval: updates.flushInterval,
      }),
      ...(updates.autoTrack !== undefined && { autoTrack: updates.autoTrack }),
    };

    // Update debug mode
    if (updates.debug !== undefined) {
      setDebugMode(updates.debug);
    }

    // Restart timer if interval changed
    if (
      updates.flushInterval !== undefined &&
      updates.flushInterval !== oldFlushInterval
    ) {
      this.stopFlushTimer();
      this.startFlushTimer();
    }

    this.log('Config updated', updates);
  }

  /**
   * Get current visitor ID.
   * Useful for debugging or external tools.
   *
   * @returns Current visitor ID
   */
  public getVisitorId(): VisitorId {
    return this.visitorId;
  }

  /**
   * Get current session ID.
   *
   * @returns Current session ID
   */
  public getSessionId(): SessionId {
    return this.sessionId;
  }

  /**
   * Get current configuration.
   *
   * @returns Current resolved configuration
   */
  public getConfig(): ResolvedConfig {
    return { ...this.config };
  }

  /**
   * Get current queue length.
   *
   * @returns Number of events in queue
   */
  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if SDK is initialized.
   *
   * @returns true if initialized
   */
  public isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Clean up SDK instance.
   * Flushes remaining events and removes listeners.
   */
  public destroy(): void {
    this.log('Destroying instance');

    // 1. Flush remaining events
    if (this.queue.length > 0) {
      this.handlePageUnload();
    }

    // 2. Stop flush timer
    this.stopFlushTimer();

    // 3. Remove event listeners
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.boundHandlePageUnload);
      window.removeEventListener('online', this.boundHandleOnline);
      window.removeEventListener('offline', this.boundHandleOffline);
      window.removeEventListener('popstate', this.boundHandlePopstate);
    }

    // 4. Restore original history methods
    this.restoreHistoryMethods();

    // 5. Clean up network adapter
    if (this.adapterCleanup) {
      this.adapterCleanup();
      this.adapterCleanup = null;
    }
    if (this.adapter) {
      this.adapter.destroy();
      this.adapter = null;
    }

    // 6. Clear queue
    this.queue = [];

    // 7. Mark as not initialized
    this.isInitialized = false;

    this.log('Destroyed');
  }

  // ===========================================================================
  // Debug Logging
  // ===========================================================================

  private log(message: string, ...args: unknown[]): void {
    if (__DEBUG__ && this.config.debug) console.log(`[Analytics] ${message}`, ...args);
  }

  private warn(message: string, ...args: unknown[]): void {
    if (__DEBUG__ && this.config.debug) console.warn(`[Analytics] ${message}`, ...args);
  }

  private error(message: string, ...args: unknown[]): void {
    if (__DEBUG__ && this.config.debug) console.error(`[Analytics] ${message}`, ...args);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new Analytics instance.
 * Convenience function that wraps the class constructor.
 *
 * @param config - Analytics configuration
 * @returns New Analytics instance
 */
export function createAnalytics(config: AnalyticsConfig): Analytics {
  return new Analytics(config);
}
