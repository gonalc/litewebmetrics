/**
 * @youranalytics/web-sdk Network Adapter
 * Adaptive behavior for different network conditions
 * Optimized for 2G/3G networks with smart batching and compression
 */

import type { ConnectionType, RawEvent, EventBatch } from './types';
import { getConnectionType, supportsCompression, debounce, getNavigatorConnection, type NavigatorConnection } from './utils';
import { sendBeacon, sendFetch, sendCompressed, NetworkError, delay } from './network';

// =============================================================================
// Types
// =============================================================================

/**
 * Batching strategy based on network conditions.
 * - aggressive: Large batches, less frequent sends (slow networks)
 * - balanced: Medium batches, moderate frequency (3G)
 * - conservative: Small batches, frequent sends (fast networks)
 */
export type BatchingStrategy = 'aggressive' | 'balanced' | 'conservative';

/**
 * Adaptive settings computed from network conditions.
 */
export interface AdaptiveSettings {
  /** Maximum events to queue before forcing a flush */
  maxQueueSize: number;
  /** Interval between automatic flushes in milliseconds */
  flushInterval: number;
  /** Whether to compress event payloads */
  compressionEnabled: boolean;
  /** Batching strategy name */
  batchingStrategy: BatchingStrategy;
}

/** Event priority levels for request prioritization */
export const EventPriority = { LOW: 0, NORMAL: 1, HIGH: 2 } as const;
export type EventPriorityValue = (typeof EventPriority)[keyof typeof EventPriority];

/**
 * Event with priority information.
 */
export interface PrioritizedEvent extends RawEvent {
  priority: EventPriorityValue;
}

// =============================================================================
// Constants
// =============================================================================

/** Connection profile settings lookup */
const PROFILES: Record<string, AdaptiveSettings> = {
  'slow-2g': { maxQueueSize: 3, flushInterval: 15000, compressionEnabled: true, batchingStrategy: 'aggressive' },
  '2g':      { maxQueueSize: 5, flushInterval: 10000, compressionEnabled: true, batchingStrategy: 'aggressive' },
  '3g':      { maxQueueSize: 10, flushInterval: 5000, compressionEnabled: false, batchingStrategy: 'balanced' },
  '4g':      { maxQueueSize: 20, flushInterval: 3000, compressionEnabled: false, batchingStrategy: 'conservative' },
  'data-saver': { maxQueueSize: 10, flushInterval: 20000, compressionEnabled: true, batchingStrategy: 'aggressive' },
};

/** Maximum backoff delay in milliseconds */
const MAX_BACKOFF_DELAY = 30000;

/** Base delay for exponential backoff */
const BASE_BACKOFF_DELAY = 1000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if user has enabled data saver mode.
 * Data saver mode indicates the user wants to minimize data usage.
 *
 * @returns true if data saver is enabled
 */
export function isDataSaverEnabled(): boolean {
  const connection = getNavigatorConnection();
  return connection?.saveData === true;
}

/**
 * Get the round-trip time (RTT) in milliseconds.
 * Returns a default value if not available.
 *
 * @returns RTT in milliseconds
 */
export function getRtt(): number {
  const connection = getNavigatorConnection();
  return connection?.rtt ?? 100; // Default to 100ms if unknown
}

/**
 * Get the downlink speed in Mbps.
 * Returns a default value if not available.
 *
 * @returns Downlink speed in Mbps
 */
export function getDownlink(): number {
  const connection = getNavigatorConnection();
  return connection?.downlink ?? 10; // Default to 10 Mbps if unknown
}

/**
 * Sort events by priority (high priority first).
 * Useful for slow connections where high-priority events should be sent first.
 *
 * @param events - Array of prioritized events
 * @returns Sorted array with high priority events first
 */
export function sortByPriority(events: PrioritizedEvent[]): PrioritizedEvent[] {
  return [...events].sort((a, b) => b.priority - a.priority);
}

/**
 * Assign priority to an event based on its type.
 *
 * @param event - Raw event to prioritize
 * @returns Event with priority assigned
 */
export function assignPriority(event: RawEvent): PrioritizedEvent {
  const eventName = event.event.toLowerCase();

  // High priority events
  if (
    eventName.includes('purchase') ||
    eventName.includes('conversion') ||
    eventName.includes('signup') ||
    eventName.includes('error') ||
    eventName.includes('checkout') ||
    eventName.includes('subscribe')
  ) {
    return { ...event, priority: EventPriority.HIGH };
  }

  // Low priority events
  if (
    eventName === 'pageview' ||
    eventName.includes('impression') ||
    eventName.includes('scroll') ||
    eventName.includes('hover')
  ) {
    return { ...event, priority: EventPriority.LOW };
  }

  // Normal priority for everything else
  return { ...event, priority: EventPriority.NORMAL };
}

// =============================================================================
// RetryStrategy Class
// =============================================================================

/** Max retries per connection type */
const RETRY_MAP: Record<string, number> = { 'slow-2g': 5, '2g': 3, '3g': 2 };

/** Smart retry strategy with exponential backoff. */
export class RetryStrategy {
  private attempts = 0;
  private readonly maxRetries: number;

  constructor(connectionType: ConnectionType = 'unknown') {
    this.maxRetries = RETRY_MAP[connectionType] ?? 2;
  }

  getBackoffDelay(): number {
    return Math.min(BASE_BACKOFF_DELAY * Math.pow(2, this.attempts), MAX_BACKOFF_DELAY);
  }

  shouldRetry(error: Error): boolean {
    if (this.attempts >= this.maxRetries) return false;
    if (error instanceof NetworkError) {
      if (error.retry === false) return false;
      const s = error.statusCode;
      if (s !== undefined && s >= 400 && s < 500 && s !== 429) return false;
      return true;
    }
    return true;
  }

  recordAttempt(): void { this.attempts++; }
  reset(): void { this.attempts = 0; }
  getAttempts(): number { return this.attempts; }
  getMaxRetries(): number { return this.maxRetries; }
}

// =============================================================================
// NetworkAdapter Class
// =============================================================================

/**
 * Network adapter that provides adaptive settings based on connection quality.
 * Listens for connection changes and notifies subscribers.
 */
export class NetworkAdapter {
  private currentSettings: AdaptiveSettings;
  private connection: NavigatorConnection | null = null;
  private changeCallbacks: Array<(settings: AdaptiveSettings) => void> = [];
  private boundHandleChange: () => void;
  private cachedConnectionType: ConnectionType = 'unknown';
  private lastUpdateTime = 0;
  private readonly cacheTimeout = 1000; // Cache for 1 second

  /**
   * Create a new network adapter.
   * Automatically detects connection and sets up listeners.
   */
  constructor() {
    // Get navigator.connection if available
    this.connection = getNavigatorConnection();

    // Determine initial settings
    this.currentSettings = this.computeSettings();

    // Create debounced change handler
    this.boundHandleChange = debounce(() => {
      this.handleConnectionChange();
    }, 100);

    // Listen for connection changes
    if (this.connection?.addEventListener) {
      this.connection.addEventListener('change', this.boundHandleChange);
    }
  }

  /**
   * Compute settings based on current connection.
   */
  private computeSettings(): AdaptiveSettings {
    if (isDataSaverEnabled()) return { ...PROFILES['data-saver'] };
    const type = this.getConnectionType();
    return { ...(PROFILES[type] || PROFILES['4g']) };
  }

  /**
   * Handle connection change event.
   */
  private handleConnectionChange(): void {
    // Invalidate cache
    this.lastUpdateTime = 0;

    // Compute new settings
    const newSettings = this.computeSettings();

    // Check if settings actually changed
    if (
      newSettings.maxQueueSize === this.currentSettings.maxQueueSize &&
      newSettings.flushInterval === this.currentSettings.flushInterval &&
      newSettings.compressionEnabled === this.currentSettings.compressionEnabled
    ) {
      return;
    }

    this.currentSettings = newSettings;

    // Notify subscribers
    for (const callback of this.changeCallbacks) {
      try {
        callback(newSettings);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Get current connection type with caching.
   */
  private getConnectionType(): ConnectionType {
    const now = Date.now();

    // Return cached value if fresh
    if (now - this.lastUpdateTime < this.cacheTimeout) {
      return this.cachedConnectionType;
    }

    // Update cache
    this.cachedConnectionType = getConnectionType();
    this.lastUpdateTime = now;

    return this.cachedConnectionType;
  }

  /**
   * Get current adaptive settings.
   *
   * @returns Current settings based on connection quality
   */
  getSettings(): AdaptiveSettings {
    return { ...this.currentSettings };
  }

  /**
   * Register a callback for connection changes.
   * Callback is invoked when connection quality changes.
   *
   * @param callback - Function to call with new settings
   * @returns Cleanup function to remove the callback
   */
  onConnectionChange(
    callback: (settings: AdaptiveSettings) => void
  ): () => void {
    this.changeCallbacks.push(callback);

    return () => {
      const index = this.changeCallbacks.indexOf(callback);
      if (index > -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Check if compression should be used.
   * Based on connection type, CompressionStream availability, and data saver mode.
   *
   * @returns true if compression should be enabled
   */
  shouldCompress(): boolean {
    // Check if CompressionStream is available
    if (!supportsCompression()) {
      return false;
    }

    // Always compress in data saver mode
    if (isDataSaverEnabled()) {
      return true;
    }

    // Compress based on current settings
    return this.currentSettings.compressionEnabled;
  }

  /**
   * Get the optimal batch size for current connection.
   * Considers connection speed, RTT, and data saver mode.
   *
   * @returns Optimal batch size
   */
  getOptimalBatchSize(): number {
    const rtt = getRtt();
    const downlink = getDownlink();

    // In data saver mode, use larger batches
    if (isDataSaverEnabled()) {
      return 15;
    }

    // Adjust based on RTT (high latency = larger batches)
    if (rtt > 500) {
      return Math.min(this.currentSettings.maxQueueSize + 5, 20);
    }

    // Adjust based on downlink (slow = larger batches)
    if (downlink < 1) {
      return Math.min(this.currentSettings.maxQueueSize + 3, 15);
    }

    return this.currentSettings.maxQueueSize;
  }

  /**
   * Get a retry strategy appropriate for current connection.
   *
   * @returns RetryStrategy configured for connection
   */
  getRetryStrategy(): RetryStrategy {
    return new RetryStrategy(this.getConnectionType());
  }

  /**
   * Check if network conditions are poor.
   *
   * @returns true if on slow connection
   */
  isSlowConnection(): boolean {
    const type = this.getConnectionType();
    return type === 'slow-2g' || type === '2g';
  }

  /**
   * Get recommended timeout for requests.
   * Based on RTT and connection type.
   *
   * @returns Timeout in milliseconds
   */
  getRecommendedTimeout(): number {
    const timeouts: Record<string, number> = { 'slow-2g': 30000, '2g': 20000, '3g': 15000 };
    return (timeouts[this.getConnectionType()] ?? 10000) + getRtt() * 2;
  }

  /**
   * Clean up the adapter.
   * Removes event listeners.
   */
  destroy(): void {
    if (this.connection?.removeEventListener) {
      this.connection.removeEventListener('change', this.boundHandleChange);
    }

    this.changeCallbacks = [];
  }
}

// =============================================================================
// Adaptive Sending
// =============================================================================

/**
 * Send data with adaptive behavior based on network conditions.
 * Chooses the best transport method and applies compression as needed.
 *
 * @param url - Endpoint URL
 * @param data - Event batch to send
 * @param adapter - Network adapter for connection info
 */
export async function sendAdaptive(
  url: string,
  data: EventBatch,
  adapter: NetworkAdapter
): Promise<void> {
  const retryStrategy = adapter.getRetryStrategy();
  const shouldCompress = adapter.shouldCompress();

  // Prioritize events on slow connections
  if (adapter.isSlowConnection()) {
    const prioritizedEvents = data.events.map((e) => assignPriority(e));
    const sortedEvents = sortByPriority(prioritizedEvents);
    data = {
      ...data,
      events: sortedEvents,
    };
  }

  // Choose transport method based on connection
  const connectionType = getConnectionType();

  while (true) {
    try {
      // For 4G, prefer sendBeacon (non-blocking)
      if (connectionType === '4g' || connectionType === 'unknown') {
        if (sendBeacon(url, data)) {
          return;
        }
        // Fall through to fetch if beacon fails
      }

      // For slower connections or when beacon fails, use fetch
      if (shouldCompress) {
        await sendCompressed(url, data);
      } else {
        await sendFetch(url, data);
      }

      return; // Success!
    } catch (error) {
      retryStrategy.recordAttempt();

      const err = error instanceof Error ? error : new Error(String(error));

      if (!retryStrategy.shouldRetry(err)) {
        throw error;
      }

      // Wait before retrying
      const backoffDelay = retryStrategy.getBackoffDelay();
      await delay(backoffDelay);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/** Global network adapter instance */
let globalAdapter: NetworkAdapter | null = null;

/**
 * Get or create the global network adapter instance.
 *
 * @returns Global NetworkAdapter instance
 */
export function getNetworkAdapter(): NetworkAdapter {
  if (!globalAdapter) {
    globalAdapter = new NetworkAdapter();
  }
  return globalAdapter;
}

/**
 * Reset the global adapter (for testing).
 */
export function resetNetworkAdapter(): void {
  if (globalAdapter) {
    globalAdapter.destroy();
    globalAdapter = null;
  }
}
