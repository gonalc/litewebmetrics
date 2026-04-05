import { describe, expect, test } from 'bun:test';
import {
  isValidEvent,
  isValidConfig,
  isValidQueuedEvent,
  isValidUtmParams,
  createVisitorId,
  createSessionId,
  DEFAULT_CONFIG,
  type RawEvent,
  type AnalyticsConfig,
  type QueuedEvent,
  type VisitorId,
  type SessionId,
} from '../src/types';

// =============================================================================
// Test Fixtures
// =============================================================================

const validRawEvent: RawEvent = {
  event: 'pageview',
  properties: { path: '/home' },
  timestamp: Date.now(),
  visitor_id: 'v_123',
  session_id: 's_456',
  page_url: 'https://example.com/home',
  page_title: 'Home Page',
  referrer: 'https://google.com',
  user_agent: 'Mozilla/5.0',
  screen_width: 1920,
  screen_height: 1080,
  utm: {
    source: 'google',
    medium: 'cpc',
  },
};

const validConfig: AnalyticsConfig = {
  apiKey: 'pk_test_123',
  endpoint: 'https://api.example.com',
  debug: true,
  maxQueueSize: 20,
  flushInterval: 10000,
  autoTrack: false,
};

const validQueuedEvent: QueuedEvent = {
  event: 'click',
  properties: { button: 'signup' },
  timestamp: Date.now(),
};

const SERVER_URL = 'https://analytics.test.example.com'

// =============================================================================
// isValidEvent Tests
// =============================================================================

describe('isValidEvent', () => {
  test('accepts valid event with all fields', () => {
    expect(isValidEvent(validRawEvent)).toBe(true);
  });

  test('accepts valid event with minimal fields', () => {
    const minimalEvent: RawEvent = {
      event: 'pageview',
      properties: {},
      timestamp: Date.now(),
      visitor_id: 'v_123',
      session_id: 's_456',
      page_url: 'https://example.com',
      user_agent: 'Mozilla/5.0',
      screen_width: 1920,
      screen_height: 1080,
    };
    expect(isValidEvent(minimalEvent)).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidEvent(null)).toBe(false);
  });

  test('rejects undefined', () => {
    expect(isValidEvent(undefined)).toBe(false);
  });

  test('rejects primitive values', () => {
    expect(isValidEvent('string')).toBe(false);
    expect(isValidEvent(123)).toBe(false);
    expect(isValidEvent(true)).toBe(false);
  });

  test('rejects empty object', () => {
    expect(isValidEvent({})).toBe(false);
  });

  test('rejects event with empty event name', () => {
    expect(isValidEvent({ ...validRawEvent, event: '' })).toBe(false);
  });

  test('rejects event with non-string event name', () => {
    expect(isValidEvent({ ...validRawEvent, event: 123 })).toBe(false);
  });

  test('rejects event with invalid timestamp', () => {
    expect(isValidEvent({ ...validRawEvent, timestamp: 'not-a-number' })).toBe(
      false
    );
    expect(isValidEvent({ ...validRawEvent, timestamp: NaN })).toBe(false);
    expect(isValidEvent({ ...validRawEvent, timestamp: Infinity })).toBe(false);
  });

  test('rejects event with invalid screen dimensions', () => {
    expect(isValidEvent({ ...validRawEvent, screen_width: 'wide' })).toBe(
      false
    );
    expect(isValidEvent({ ...validRawEvent, screen_height: null })).toBe(false);
  });

  test('rejects event with non-object properties', () => {
    expect(isValidEvent({ ...validRawEvent, properties: 'string' })).toBe(
      false
    );
    expect(isValidEvent({ ...validRawEvent, properties: null })).toBe(false);
  });

  test('rejects event with invalid utm params', () => {
    expect(isValidEvent({ ...validRawEvent, utm: { source: 123 } })).toBe(
      false
    );
    expect(isValidEvent({ ...validRawEvent, utm: 'google' })).toBe(false);
  });

  test('rejects event with invalid optional fields', () => {
    expect(isValidEvent({ ...validRawEvent, page_title: 123 })).toBe(false);
    expect(isValidEvent({ ...validRawEvent, referrer: true })).toBe(false);
  });
});

// =============================================================================
// isValidConfig Tests
// =============================================================================

describe('isValidConfig', () => {
  test('accepts valid config with all fields', () => {
    expect(isValidConfig(validConfig)).toBe(true);
  });

  test('accepts minimal config with only apiKey', () => {
    expect(isValidConfig({ apiKey: 'pk_test_123' })).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidConfig(null)).toBe(false);
  });

  test('rejects undefined', () => {
    expect(isValidConfig(undefined)).toBe(false);
  });

  test('rejects empty object (missing apiKey)', () => {
    expect(isValidConfig({})).toBe(false);
  });

  test('rejects config with empty apiKey', () => {
    expect(isValidConfig({ apiKey: '' })).toBe(false);
  });

  test('rejects config with non-string apiKey', () => {
    expect(isValidConfig({ apiKey: 123 })).toBe(false);
    expect(isValidConfig({ apiKey: null })).toBe(false);
  });

  test('rejects config with invalid endpoint', () => {
    expect(isValidConfig({ apiKey: 'pk_test', endpoint: 123 })).toBe(false);
  });

  test('rejects config with invalid debug', () => {
    expect(isValidConfig({ apiKey: 'pk_test', debug: 'true' })).toBe(false);
  });

  test('rejects config with invalid maxQueueSize', () => {
    expect(isValidConfig({ apiKey: 'pk_test', maxQueueSize: 0 })).toBe(false);
    expect(isValidConfig({ apiKey: 'pk_test', maxQueueSize: -1 })).toBe(false);
    expect(isValidConfig({ apiKey: 'pk_test', maxQueueSize: 1.5 })).toBe(false);
    expect(isValidConfig({ apiKey: 'pk_test', maxQueueSize: '10' })).toBe(
      false
    );
  });

  test('rejects config with invalid flushInterval', () => {
    expect(isValidConfig({ apiKey: 'pk_test', flushInterval: -1 })).toBe(false);
    expect(isValidConfig({ apiKey: 'pk_test', flushInterval: 1.5 })).toBe(
      false
    );
  });

  test('accepts config with flushInterval of 0', () => {
    expect(isValidConfig({ apiKey: 'pk_test', flushInterval: 0 })).toBe(true);
  });

  test('rejects config with invalid autoTrack', () => {
    expect(isValidConfig({ apiKey: 'pk_test', autoTrack: 1 })).toBe(false);
  });
});

// =============================================================================
// isValidQueuedEvent Tests
// =============================================================================

describe('isValidQueuedEvent', () => {
  test('accepts valid queued event', () => {
    expect(isValidQueuedEvent(validQueuedEvent)).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidQueuedEvent(null)).toBe(false);
  });

  test('rejects event with empty name', () => {
    expect(isValidQueuedEvent({ ...validQueuedEvent, event: '' })).toBe(false);
  });

  test('rejects event with invalid properties', () => {
    expect(
      isValidQueuedEvent({ ...validQueuedEvent, properties: null })
    ).toBe(false);
  });

  test('rejects event with invalid timestamp', () => {
    expect(
      isValidQueuedEvent({ ...validQueuedEvent, timestamp: NaN })
    ).toBe(false);
  });
});

// =============================================================================
// isValidUtmParams Tests
// =============================================================================

describe('isValidUtmParams', () => {
  test('accepts valid utm params', () => {
    expect(isValidUtmParams({ source: 'google', medium: 'cpc' })).toBe(true);
  });

  test('accepts empty object', () => {
    expect(isValidUtmParams({})).toBe(true);
  });

  test('accepts all utm fields', () => {
    expect(
      isValidUtmParams({
        source: 'google',
        medium: 'cpc',
        campaign: 'summer',
        term: 'analytics',
        content: 'banner',
      })
    ).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidUtmParams(null)).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isValidUtmParams({ source: 123 })).toBe(false);
  });

  test('rejects unknown keys', () => {
    expect(isValidUtmParams({ source: 'google', unknown: 'value' })).toBe(
      false
    );
  });
});

// =============================================================================
// Branded Types Tests
// =============================================================================

describe('Branded Types', () => {
  test('createVisitorId creates a VisitorId', () => {
    const visitorId: VisitorId = createVisitorId('v_123');
    expect(visitorId).toBe('v_123');
  });

  test('createSessionId creates a SessionId', () => {
    const sessionId: SessionId = createSessionId('s_456');
    expect(sessionId).toBe('s_456');
  });

  test('branded types are type-safe at compile time', () => {
    const visitorId: VisitorId = createVisitorId('v_123');
    const sessionId: SessionId = createSessionId('s_456');

    // These should work
    const v: string = visitorId;
    const s: string = sessionId;

    expect(v).toBe('v_123');
    expect(s).toBe('s_456');

    // Note: The following would cause compile errors (uncomment to verify):
    // const wrongAssignment: VisitorId = sessionId; // Error!
    // const wrongAssignment2: SessionId = visitorId; // Error!
  });
});

// =============================================================================
// DEFAULT_CONFIG Tests
// =============================================================================

describe('DEFAULT_CONFIG', () => {
  test('has correct default values', () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty('endpoint');
    expect(DEFAULT_CONFIG.debug).toBe(false);
    expect(DEFAULT_CONFIG.maxQueueSize).toBe(10);
    expect(DEFAULT_CONFIG.flushInterval).toBe(5000);
    expect(DEFAULT_CONFIG.autoTrack).toBe(true);
  });
});
