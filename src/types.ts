/**
 * @youranalytics/web-sdk Type Definitions
 * Comprehensive types for the analytics SDK
 */

// =============================================================================
// Branded Types (for type-safe IDs)
// =============================================================================

/**
 * Unique visitor identifier that persists across sessions.
 * Branded type prevents mixing with other string IDs.
 */
export type VisitorId = string & { readonly __brand: 'VisitorId' };

/**
 * Session identifier that resets on new browser session.
 * Branded type prevents mixing with other string IDs.
 */
export type SessionId = string & { readonly __brand: 'SessionId' };

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Analytics SDK configuration options.
 * Only `apiKey` is required; all other options have sensible defaults.
 */
export type AnalyticsConfig = {
  /** API key from analytics dashboard (required) */
  readonly apiKey: string;

  /** Analytics server endpoint — override if self-hosting (defaults to the hosted service) */
  readonly endpoint?: string;

  /** Enable debug logging to console */
  readonly debug?: boolean; // default: false

  /** Max events before auto-flush */
  readonly maxQueueSize?: number; // default: 10

  /** Flush interval in milliseconds */
  readonly flushInterval?: number; // default: 5000

  /** Auto-track page views on initialization and navigation */
  readonly autoTrack?: boolean; // default: true

  /** Enable adaptive network behavior (adjusts batching based on connection quality) */
  readonly adaptiveNetwork?: boolean; // default: true
};

/**
 * Resolved configuration with all defaults applied.
 * Used internally after merging user config with defaults.
 */
export type ResolvedConfig = {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly debug: boolean;
  readonly maxQueueSize: number;
  readonly flushInterval: number;
  readonly autoTrack: boolean;
  readonly adaptiveNetwork: boolean;
};

// =============================================================================
// UTM Tracking
// =============================================================================

/**
 * UTM parameters for campaign tracking.
 * Extracted from URL query parameters.
 */
export type UtmParams = {
  /** Traffic source (e.g., 'google', 'newsletter') */
  readonly source?: string; // utm_source

  /** Marketing medium (e.g., 'cpc', 'email') */
  readonly medium?: string; // utm_medium

  /** Campaign name */
  readonly campaign?: string; // utm_campaign

  /** Paid search keyword */
  readonly term?: string; // utm_term

  /** Ad content identifier */
  readonly content?: string; // utm_content
};

// =============================================================================
// Event Types
// =============================================================================

/**
 * Raw event as sent to the analytics server.
 * Contains all tracking data including context.
 */
export type RawEvent = {
  /** Event name (e.g., 'pageview', 'click', 'signup') */
  readonly event: string;

  /** Custom event properties */
  readonly properties: Record<string, unknown>;

  /** Client timestamp (milliseconds since epoch) */
  readonly timestamp: number;

  /** Unique visitor identifier (persists across sessions) */
  readonly visitor_id: string;

  /** Session identifier (resets on new browser session) */
  readonly session_id: string;

  /** Current page URL */
  readonly page_url: string;

  /** Page title */
  readonly page_title?: string;

  /** Referrer URL */
  readonly referrer?: string;

  /** User agent string */
  readonly user_agent: string;

  /** Screen width in pixels */
  readonly screen_width: number;

  /** Screen height in pixels */
  readonly screen_height: number;

  /** UTM parameters if present */
  readonly utm?: UtmParams;
};

/**
 * Queued event waiting to be flushed.
 * Contains only user-provided data; context is added at flush time.
 */
export type QueuedEvent = {
  /** Event name */
  readonly event: string;

  /** Custom event properties */
  readonly properties: Record<string, unknown>;

  /** Timestamp when event was queued */
  readonly timestamp: number;
};

// =============================================================================
// Network Types
// =============================================================================

/**
 * Network connection type as reported by the Network Information API.
 * Used for adaptive batching strategies.
 */
export type ConnectionType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

/**
 * Network information for adaptive behavior.
 * Based on the Network Information API.
 */
export type NetworkInfo = {
  /** Effective connection type */
  readonly effectiveType: ConnectionType;

  /** Downlink speed in Mbps */
  readonly downlink?: number;

  /** Round-trip time in milliseconds */
  readonly rtt?: number;

  /** Whether the user has enabled data saver mode */
  readonly saveData?: boolean;
};

// =============================================================================
// Batch Types
// =============================================================================

/**
 * Batch of events sent to the server.
 * Includes API key for authentication.
 */
export type EventBatch = {
  /** API key for authentication */
  readonly api_key: string;

  /** Array of events in this batch */
  readonly events: readonly RawEvent[];
};

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Adaptive settings computed based on network conditions.
 * Adjusts SDK behavior for optimal performance.
 */
export type AdaptiveSettings = {
  /** Maximum events to queue before forcing a flush */
  readonly maxQueueSize: number;

  /** Interval between automatic flushes in milliseconds */
  readonly flushInterval: number;

  /** Whether to compress event payloads */
  readonly compressionEnabled: boolean;
};

/**
 * SDK internal state.
 */
export type SdkState = {
  /** Whether the SDK has been initialized */
  initialized: boolean;

  /** Current event queue */
  queue: QueuedEvent[];

  /** Flush timer ID */
  flushTimerId: ReturnType<typeof setTimeout> | null;

  /** Current visitor ID */
  visitorId: VisitorId | null;

  /** Current session ID */
  sessionId: SessionId | null;
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Check if a value is a valid UTM params object.
 */
export function isValidUtmParams(value: unknown): value is UtmParams {
  if (!isObject(value)) return false;

  const allowedKeys = ['source', 'medium', 'campaign', 'term', 'content'];
  const keys = Object.keys(value);

  return keys.every(
    (key) =>
      allowedKeys.includes(key) &&
      (value[key] === undefined || typeof value[key] === 'string')
  );
}

/**
 * Check if a value is a valid RawEvent.
 * Performs runtime validation of event structure.
 */
export function isValidEvent(value: unknown): value is RawEvent {
  if (!isObject(value)) return false;

  const event = value as Record<string, unknown>;

  // Required string fields
  if (typeof event.event !== 'string' || event.event.length === 0) return false;
  if (typeof event.visitor_id !== 'string') return false;
  if (typeof event.session_id !== 'string') return false;
  if (typeof event.page_url !== 'string') return false;
  if (typeof event.user_agent !== 'string') return false;

  // Required number fields
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp))
    return false;
  if (
    typeof event.screen_width !== 'number' ||
    !Number.isFinite(event.screen_width)
  )
    return false;
  if (
    typeof event.screen_height !== 'number' ||
    !Number.isFinite(event.screen_height)
  )
    return false;

  // Properties must be an object
  if (!isObject(event.properties)) return false;

  // Optional fields
  if (event.page_title !== undefined && typeof event.page_title !== 'string')
    return false;
  if (event.referrer !== undefined && typeof event.referrer !== 'string')
    return false;
  if (event.utm !== undefined && !isValidUtmParams(event.utm)) return false;

  return true;
}

/**
 * Check if a value is a valid AnalyticsConfig.
 */
export function isValidConfig(value: unknown): value is AnalyticsConfig {
  if (!isObject(value)) return false;

  const config = value as Record<string, unknown>;

  // Required: apiKey must be a non-empty string
  if (typeof config.apiKey !== 'string' || config.apiKey.length === 0)
    return false;

  // Optional fields
  if (config.endpoint !== undefined && typeof config.endpoint !== 'string')
    return false;
  if (config.debug !== undefined && typeof config.debug !== 'boolean')
    return false;
  if (config.maxQueueSize !== undefined) {
    if (
      typeof config.maxQueueSize !== 'number' ||
      !Number.isInteger(config.maxQueueSize) ||
      config.maxQueueSize < 1
    )
      return false;
  }
  if (config.flushInterval !== undefined) {
    if (
      typeof config.flushInterval !== 'number' ||
      !Number.isInteger(config.flushInterval) ||
      config.flushInterval < 0
    )
      return false;
  }
  if (config.autoTrack !== undefined && typeof config.autoTrack !== 'boolean')
    return false;

  return true;
}

/**
 * Check if a value is a valid QueuedEvent.
 */
export function isValidQueuedEvent(value: unknown): value is QueuedEvent {
  if (!isObject(value)) return false;

  const event = value as Record<string, unknown>;

  if (typeof event.event !== 'string' || event.event.length === 0) return false;
  if (!isObject(event.properties)) return false;
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp))
    return false;

  return true;
}

// =============================================================================
// Branded Type Constructors
// =============================================================================

/**
 * Create a branded VisitorId from a string.
 * Use this when generating or parsing visitor IDs.
 */
export function createVisitorId(id: string): VisitorId {
  return id as VisitorId;
}

/**
 * Create a branded SessionId from a string.
 * Use this when generating or parsing session IDs.
 */
export function createSessionId(id: string): SessionId {
  return id as SessionId;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'apiKey' | 'endpoint'> = {
  debug: false,
  maxQueueSize: 10,
  flushInterval: 5000,
  autoTrack: true,
  adaptiveNetwork: true,
} as const;
