import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  sendBeacon,
  sendFetch,
  sendWithRetry,
  compressData,
  sendCompressed,
  queueOfflineEvents,
  getOfflineEvents,
  clearOfflineEvents,
  isOffline,
  onOnline,
  generateRequestId,
  wasRequestSent,
  markRequestSent,
  clearSentRequests,
  send,
  setDebugMode,
  NetworkError,
  _testing,
} from '../src/network';
import { resetCapabilityCache } from '../src/utils';
import type { EventBatch, RawEvent } from '../src/types';

// =============================================================================
// Mock Storage Implementation
// =============================================================================

class MockStorage implements Storage {
  private store = new Map<string, string>();
  private _disabled = false;
  private _quotaExceeded = false;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    if (this._disabled) {
      throw new Error('Storage is disabled');
    }
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    if (this._disabled) {
      throw new Error('Storage is disabled');
    }
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this._disabled) {
      throw new Error('Storage is disabled');
    }
    if (this._quotaExceeded) {
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.store.set(key, value);
  }

  disable(): void {
    this._disabled = true;
  }

  enable(): void {
    this._disabled = false;
  }

  simulateQuotaExceeded(): void {
    this._quotaExceeded = true;
  }

  resetQuota(): void {
    this._quotaExceeded = false;
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    event: 'pageview',
    properties: {},
    timestamp: Date.now(),
    visitor_id: 'visitor_123',
    session_id: 'session_456',
    page_url: 'https://example.com/page',
    page_title: 'Test Page',
    referrer: 'https://google.com',
    user_agent: 'Mozilla/5.0 Test',
    screen_width: 1920,
    screen_height: 1080,
    ...overrides,
  };
}

function createTestBatch(events: RawEvent[] = [createTestEvent()]): EventBatch {
  return {
    api_key: 'test_api_key_123',
    events,
  };
}

// =============================================================================
// Mock Setup
// =============================================================================

let mockLocalStorage: MockStorage;
let mockSessionStorage: MockStorage;
let originalLocalStorage: Storage | undefined;
let originalSessionStorage: Storage | undefined;
let originalNavigator: Navigator | undefined;
let originalFetch: typeof fetch | undefined;

// Mock navigator with sendBeacon and onLine
const createMockNavigator = (options: {
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
  onLine?: boolean;
} = {}) => ({
  sendBeacon: options.sendBeacon ?? mock(() => true),
  onLine: options.onLine ?? true,
  userAgent: 'Mozilla/5.0 Test Browser',
});

// Mock fetch response
const createMockFetchResponse = (options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
} = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  statusText: options.statusText ?? 'OK',
  json: options.json ?? (() => Promise.resolve({ received: 1 })),
});

beforeEach(() => {
  // Create fresh mock storage instances
  mockLocalStorage = new MockStorage();
  mockSessionStorage = new MockStorage();

  // Save originals
  originalLocalStorage = (globalThis as Record<string, unknown>).localStorage as Storage | undefined;
  originalSessionStorage = (globalThis as Record<string, unknown>).sessionStorage as Storage | undefined;
  originalNavigator = (globalThis as Record<string, unknown>).navigator as Navigator | undefined;
  originalFetch = (globalThis as Record<string, unknown>).fetch as typeof fetch | undefined;

  // Install mocks
  (globalThis as Record<string, unknown>).localStorage = mockLocalStorage;
  (globalThis as Record<string, unknown>).sessionStorage = mockSessionStorage;
  (globalThis as Record<string, unknown>).navigator = createMockNavigator();
  (globalThis as Record<string, unknown>).fetch = mock(() =>
    Promise.resolve(createMockFetchResponse())
  );

  // Reset caches
  resetCapabilityCache();
  clearOfflineEvents();
  clearSentRequests();

  // Enable debug for better test output
  setDebugMode(false);
});

afterEach(() => {
  // Restore originals
  if (originalLocalStorage !== undefined) {
    (globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
  }
  if (originalSessionStorage !== undefined) {
    (globalThis as Record<string, unknown>).sessionStorage = originalSessionStorage;
  }
  if (originalNavigator !== undefined) {
    (globalThis as Record<string, unknown>).navigator = originalNavigator;
  }
  if (originalFetch !== undefined) {
    (globalThis as Record<string, unknown>).fetch = originalFetch;
  }

  resetCapabilityCache();
});

// =============================================================================
// NetworkError Tests
// =============================================================================

describe('NetworkError', () => {
  test('creates error with message only', () => {
    const error = new NetworkError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('NetworkError');
    expect(error.statusCode).toBeUndefined();
    expect(error.retry).toBeUndefined();
  });

  test('creates error with status code', () => {
    const error = new NetworkError('HTTP error', 500);
    expect(error.message).toBe('HTTP error');
    expect(error.statusCode).toBe(500);
  });

  test('creates error with retry flag', () => {
    const error = new NetworkError('Network failed', undefined, true);
    expect(error.retry).toBe(true);
  });

  test('creates error with all properties', () => {
    const error = new NetworkError('Server error', 503, true);
    expect(error.message).toBe('Server error');
    expect(error.statusCode).toBe(503);
    expect(error.retry).toBe(true);
  });

  test('is an instance of Error', () => {
    const error = new NetworkError('Test');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof NetworkError).toBe(true);
  });
});

// =============================================================================
// sendBeacon Tests
// =============================================================================

describe('sendBeacon', () => {
  test('sends data successfully', () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    const result = sendBeacon('https://api.example.com/events', batch);

    expect(result).toBe(true);
    expect(mockSendBeacon).toHaveBeenCalledTimes(1);

    // Verify URL
    const [url] = mockSendBeacon.mock.calls[0];
    expect(url).toBe('https://api.example.com/events');
  });

  test('sends data as JSON blob', () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    sendBeacon('https://api.example.com/events', batch);

    // Verify the data is a Blob
    const [, data] = mockSendBeacon.mock.calls[0];
    expect(data instanceof Blob).toBe(true);
    expect((data as Blob).type).toContain('application/json');
  });

  test('returns false when sendBeacon not available', () => {
    (globalThis as Record<string, unknown>).navigator = {
      onLine: true,
      userAgent: 'Test',
    };
    resetCapabilityCache();

    const batch = createTestBatch();
    const result = sendBeacon('https://api.example.com/events', batch);

    expect(result).toBe(false);
  });

  test('returns false when sendBeacon returns false', () => {
    const mockSendBeacon = mock(() => false);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    const result = sendBeacon('https://api.example.com/events', batch);

    expect(result).toBe(false);
  });

  test('returns false for payload exceeding 64KB', () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    // Create a large batch that exceeds 64KB
    const largeEvent = createTestEvent({
      properties: { data: 'x'.repeat(70000) },
    });
    const batch = createTestBatch([largeEvent]);

    const result = sendBeacon('https://api.example.com/events', batch);

    expect(result).toBe(false);
    expect(mockSendBeacon).not.toHaveBeenCalled();
  });

  test('catches and handles exceptions', () => {
    const mockSendBeacon = mock(() => {
      throw new Error('Browser error');
    });
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    const result = sendBeacon('https://api.example.com/events', batch);

    expect(result).toBe(false);
  });
});

// =============================================================================
// sendFetch Tests
// =============================================================================

describe('sendFetch', () => {
  test('sends data successfully', async () => {
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendFetch('https://api.example.com/events', batch);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/events');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.keepalive).toBe(true);
  });

  test('sends correct JSON body', async () => {
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendFetch('https://api.example.com/events', batch);

    const [, options] = mockFetch.mock.calls[0];
    const parsedBody = JSON.parse(options.body);

    expect(parsedBody.api_key).toBe('test_api_key_123');
    expect(parsedBody.events).toHaveLength(1);
  });

  test('throws NetworkError on 4xx response', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        createMockFetchResponse({ ok: false, status: 400, statusText: 'Bad Request' })
      )
    );
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendFetch('https://api.example.com/events', batch);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error instanceof NetworkError).toBe(true);
      expect((error as NetworkError).statusCode).toBe(400);
      expect((error as NetworkError).retry).toBe(false);
    }
  });

  test('throws retryable NetworkError on 5xx response', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        createMockFetchResponse({ ok: false, status: 500, statusText: 'Internal Server Error' })
      )
    );
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendFetch('https://api.example.com/events', batch);
      expect(true).toBe(false);
    } catch (error) {
      expect(error instanceof NetworkError).toBe(true);
      expect((error as NetworkError).statusCode).toBe(500);
      expect((error as NetworkError).retry).toBe(true);
    }
  });

  test('throws retryable NetworkError on 429 response', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        createMockFetchResponse({ ok: false, status: 429, statusText: 'Too Many Requests' })
      )
    );
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendFetch('https://api.example.com/events', batch);
      expect(true).toBe(false);
    } catch (error) {
      expect(error instanceof NetworkError).toBe(true);
      expect((error as NetworkError).statusCode).toBe(429);
      expect((error as NetworkError).retry).toBe(true);
    }
  });

  test('throws retryable NetworkError on network failure', async () => {
    const mockFetch = mock(() => Promise.reject(new Error('Network failed')));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendFetch('https://api.example.com/events', batch);
      expect(true).toBe(false);
    } catch (error) {
      expect(error instanceof NetworkError).toBe(true);
      expect((error as NetworkError).retry).toBe(true);
    }
  });

  test('throws NetworkError when fetch not available', async () => {
    (globalThis as Record<string, unknown>).fetch = undefined;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendFetch('https://api.example.com/events', batch);
      expect(true).toBe(false);
    } catch (error) {
      expect(error instanceof NetworkError).toBe(true);
      expect((error as NetworkError).retry).toBe(false);
    }
  });

  test('sends Authorization header with Bearer token when apiKey provided', async () => {
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendFetch('https://api.example.com/events', batch, 'pk_test_abc123');

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer pk_test_abc123');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  test('does not send Authorization header when apiKey not provided', async () => {
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendFetch('https://api.example.com/events', batch);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });
});

// =============================================================================
// sendWithRetry Tests
// =============================================================================

describe('sendWithRetry', () => {
  test('succeeds on first attempt', async () => {
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendWithRetry('https://api.example.com/events', batch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('retries on 5xx error', async () => {
    let callCount = 0;
    const mockFetch = mock(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve(
          createMockFetchResponse({ ok: false, status: 500 })
        );
      }
      return Promise.resolve(createMockFetchResponse());
    });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendWithRetry('https://api.example.com/events', batch, 3);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('does not retry on 4xx error', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(createMockFetchResponse({ ok: false, status: 400 }))
    );
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendWithRetry('https://api.example.com/events', batch);
      expect(true).toBe(false);
    } catch (error) {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect((error as NetworkError).retry).toBe(false);
    }
  });

  test('throws after max retries exceeded', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(createMockFetchResponse({ ok: false, status: 500 }))
    );
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendWithRetry('https://api.example.com/events', batch, 2);
      expect(true).toBe(false);
    } catch (error) {
      // Initial + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(error instanceof NetworkError).toBe(true);
    }
  });

  test('respects custom maxRetries', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(createMockFetchResponse({ ok: false, status: 500 }))
    );
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    try {
      await sendWithRetry('https://api.example.com/events', batch, 1);
      expect(true).toBe(false);
    } catch {
      // Initial + 1 retry = 2 calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }
  });

  test('passes apiKey to sendFetch for Authorization header', async () => {
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await sendWithRetry('https://api.example.com/events', batch, 3, 'pk_my_key');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer pk_my_key');
  });
});

// =============================================================================
// compressData Tests
// =============================================================================

describe('compressData', () => {
  test('returns original string when CompressionStream not available', async () => {
    // CompressionStream might not be available in test environment
    const originalCompressionStream = (globalThis as Record<string, unknown>).CompressionStream;
    (globalThis as Record<string, unknown>).CompressionStream = undefined;
    resetCapabilityCache();

    const data = JSON.stringify(createTestBatch());
    const result = await compressData(data);

    expect(result).toBe(data);

    // Restore
    if (originalCompressionStream !== undefined) {
      (globalThis as Record<string, unknown>).CompressionStream = originalCompressionStream;
    }
  });

  test('returns Blob when CompressionStream available', async () => {
    // Skip if CompressionStream not available in this environment
    if (typeof CompressionStream === 'undefined') {
      return;
    }

    resetCapabilityCache();

    const data = JSON.stringify(createTestBatch());
    const result = await compressData(data);

    expect(result instanceof Blob).toBe(true);
  });

  test('compressed data is smaller than original', async () => {
    // Skip if CompressionStream not available
    if (typeof CompressionStream === 'undefined') {
      return;
    }

    resetCapabilityCache();

    // Create larger data for better compression
    const largeEvent = createTestEvent({
      properties: {
        data: 'aaaaaaaaaa'.repeat(1000),
      },
    });
    const data = JSON.stringify(createTestBatch([largeEvent]));
    const result = await compressData(data);

    expect(result instanceof Blob).toBe(true);
    expect((result as Blob).size).toBeLessThan(data.length);
  });
});

// =============================================================================
// Offline Queue Tests
// =============================================================================

describe('queueOfflineEvents', () => {
  test('stores events in localStorage', () => {
    const events = [createTestEvent()];
    queueOfflineEvents(events);

    const stored = mockLocalStorage.getItem(_testing.OFFLINE_QUEUE_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].event).toBe('pageview');
  });

  test('appends to existing queue', () => {
    const events1 = [createTestEvent({ event: 'event1' })];
    const events2 = [createTestEvent({ event: 'event2' })];

    queueOfflineEvents(events1);
    queueOfflineEvents(events2);

    const queued = getOfflineEvents();
    expect(queued).toHaveLength(2);
    expect(queued[0].event).toBe('event1');
    expect(queued[1].event).toBe('event2');
  });

  test('limits queue to MAX_OFFLINE_EVENTS', () => {
    // Queue more than max events
    const events = Array.from({ length: 150 }, (_, i) =>
      createTestEvent({ event: `event_${i}` })
    );

    queueOfflineEvents(events);

    const queued = getOfflineEvents();
    expect(queued.length).toBe(_testing.MAX_OFFLINE_EVENTS);

    // Should keep the newest events
    expect(queued[0].event).toBe('event_50');
    expect(queued[99].event).toBe('event_149');
  });

  test('handles localStorage disabled', () => {
    mockLocalStorage.disable();

    // Should not throw
    const events = [createTestEvent()];
    queueOfflineEvents(events);

    // Queue should be empty
    mockLocalStorage.enable();
    const queued = getOfflineEvents();
    expect(queued).toHaveLength(0);
  });

  test('handles quota exceeded', () => {
    mockLocalStorage.simulateQuotaExceeded();

    // Should not throw
    const events = [createTestEvent()];
    queueOfflineEvents(events);
  });
});

describe('getOfflineEvents', () => {
  test('returns empty array when no events queued', () => {
    const events = getOfflineEvents();
    expect(events).toEqual([]);
  });

  test('returns queued events', () => {
    const events = [createTestEvent(), createTestEvent({ event: 'click' })];
    queueOfflineEvents(events);

    const queued = getOfflineEvents();
    expect(queued).toHaveLength(2);
  });

  test('returns empty array on parse error', () => {
    mockLocalStorage.setItem(_testing.OFFLINE_QUEUE_KEY, 'invalid json{');

    const events = getOfflineEvents();
    expect(events).toEqual([]);
  });

  test('returns empty array when stored data is not an array', () => {
    mockLocalStorage.setItem(_testing.OFFLINE_QUEUE_KEY, '{"not": "array"}');

    const events = getOfflineEvents();
    expect(events).toEqual([]);
  });

  test('handles localStorage disabled', () => {
    mockLocalStorage.disable();

    const events = getOfflineEvents();
    expect(events).toEqual([]);
  });
});

describe('clearOfflineEvents', () => {
  test('removes queued events', () => {
    queueOfflineEvents([createTestEvent()]);
    expect(getOfflineEvents()).toHaveLength(1);

    clearOfflineEvents();
    expect(getOfflineEvents()).toHaveLength(0);
  });

  test('handles already empty queue', () => {
    clearOfflineEvents();
    expect(getOfflineEvents()).toHaveLength(0);
  });

  test('handles localStorage disabled', () => {
    queueOfflineEvents([createTestEvent()]);
    mockLocalStorage.disable();

    // Should not throw
    clearOfflineEvents();
  });
});

// =============================================================================
// isOffline Tests
// =============================================================================

describe('isOffline', () => {
  test('returns false when online', () => {
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({ onLine: true });

    expect(isOffline()).toBe(false);
  });

  test('returns true when offline', () => {
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({ onLine: false });

    expect(isOffline()).toBe(true);
  });

  test('returns false when navigator not available', () => {
    (globalThis as Record<string, unknown>).navigator = undefined;

    expect(isOffline()).toBe(false);
  });
});

// =============================================================================
// onOnline Tests
// =============================================================================

describe('onOnline', () => {
  test('registers online event listener', () => {
    const mockAddEventListener = mock(() => {});
    const mockRemoveEventListener = mock(() => {});

    (globalThis as Record<string, unknown>).window = {
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    };

    const callback = mock(() => {});
    const cleanup = onOnline(callback);

    expect(mockAddEventListener).toHaveBeenCalledWith('online', callback);

    cleanup();
    expect(mockRemoveEventListener).toHaveBeenCalledWith('online', callback);

    // Cleanup
    (globalThis as Record<string, unknown>).window = undefined;
  });

  test('returns noop when window not available', () => {
    (globalThis as Record<string, unknown>).window = undefined;

    const callback = mock(() => {});
    const cleanup = onOnline(callback);

    // Should not throw
    cleanup();
  });
});

// =============================================================================
// Request Deduplication Tests
// =============================================================================

describe('generateRequestId', () => {
  test('generates a string', () => {
    const id = generateRequestId();
    expect(typeof id).toBe('string');
  });

  test('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });

  test('ID matches expected format (timestamp_random)', () => {
    const id = generateRequestId();
    const parts = id.split('_');

    expect(parts.length).toBe(2);

    // First part should be a valid timestamp
    const timestamp = parseInt(parts[0], 10);
    expect(Number.isNaN(timestamp)).toBe(false);

    // Should be a recent timestamp
    const now = Date.now();
    expect(timestamp).toBeLessThanOrEqual(now);
    expect(timestamp).toBeGreaterThan(now - 60000);
  });
});

describe('wasRequestSent', () => {
  test('returns false for unsent request', () => {
    const id = generateRequestId();
    expect(wasRequestSent(id)).toBe(false);
  });

  test('returns true for sent request', () => {
    const id = generateRequestId();
    markRequestSent(id);
    expect(wasRequestSent(id)).toBe(true);
  });

  test('returns false after clearing', () => {
    const id = generateRequestId();
    markRequestSent(id);
    clearSentRequests();
    expect(wasRequestSent(id)).toBe(false);
  });
});

describe('markRequestSent', () => {
  test('marks request as sent', () => {
    const id = 'test_request_123';
    markRequestSent(id);
    expect(wasRequestSent(id)).toBe(true);
  });

  test('stores in sessionStorage', () => {
    const id = 'test_request_456';
    markRequestSent(id);

    const stored = mockSessionStorage.getItem(_testing.SENT_REQUESTS_KEY);
    expect(stored).toContain(id);
  });

  test('limits stored IDs to MAX_TRACKED_REQUESTS', () => {
    // Mark more than max requests
    for (let i = 0; i < 150; i++) {
      markRequestSent(`request_${i}`);
    }

    const stored = mockSessionStorage.getItem(_testing.SENT_REQUESTS_KEY);
    const parsed = JSON.parse(stored!);

    expect(parsed.length).toBe(_testing.MAX_TRACKED_REQUESTS);

    // Should keep newest
    expect(wasRequestSent('request_149')).toBe(true);
    expect(wasRequestSent('request_0')).toBe(false);
  });

  test('handles sessionStorage disabled', () => {
    mockSessionStorage.disable();

    // Should not throw
    markRequestSent('test_id');
  });
});

describe('clearSentRequests', () => {
  test('clears all sent request IDs', () => {
    markRequestSent('request_1');
    markRequestSent('request_2');

    clearSentRequests();

    expect(wasRequestSent('request_1')).toBe(false);
    expect(wasRequestSent('request_2')).toBe(false);
  });
});

// =============================================================================
// High-Level send() Tests
// =============================================================================

describe('send', () => {
  test('uses sendBeacon by default', async () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    await send('https://api.example.com/events', batch);

    expect(mockSendBeacon).toHaveBeenCalledTimes(1);
  });

  test('falls back to fetch when beacon fails', async () => {
    const mockSendBeacon = mock(() => false);
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await send('https://api.example.com/events', batch);

    expect(mockSendBeacon).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('skips beacon when useBeacon is false', async () => {
    const mockSendBeacon = mock(() => true);
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await send('https://api.example.com/events', batch, { useBeacon: false });

    expect(mockSendBeacon).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('queues events when offline', async () => {
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      onLine: false,
    });

    const batch = createTestBatch();
    await send('https://api.example.com/events', batch);

    const queued = getOfflineEvents();
    expect(queued).toHaveLength(1);
  });

  test('skips duplicate requests', async () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    const requestId = generateRequestId();

    await send('https://api.example.com/events', batch, { requestId });
    await send('https://api.example.com/events', batch, { requestId });

    // Should only send once
    expect(mockSendBeacon).toHaveBeenCalledTimes(1);
  });

  test('marks request as sent after success', async () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();
    const requestId = generateRequestId();

    await send('https://api.example.com/events', batch, { requestId });

    expect(wasRequestSent(requestId)).toBe(true);
  });

  test('does not throw on network failure', async () => {
    const mockSendBeacon = mock(() => false);
    const mockFetch = mock(() => Promise.reject(new Error('Network failed')));
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();

    // Should not throw - disable retry to avoid timeout
    await send('https://api.example.com/events', batch, { retry: false });
  });

  test('queues events on retryable failure', async () => {
    const mockSendBeacon = mock(() => false);
    const mockFetch = mock(() => Promise.reject(new Error('Network failed')));
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await send('https://api.example.com/events', batch, { retry: false });

    const queued = getOfflineEvents();
    expect(queued).toHaveLength(1);
  });

  test('passes apiKey to fetch for Authorization header', async () => {
    const mockSendBeacon = mock(() => false);
    const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    resetCapabilityCache();

    const batch = createTestBatch();
    await send('https://api.example.com/events', batch, {
      useBeacon: false,
      retry: false,
      apiKey: 'pk_test_authorization',
    });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer pk_test_authorization');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  test('handles empty events array', async () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch([]);
    const result = sendBeacon('https://api.example.com/events', batch);

    expect(result).toBe(true);
  });

  test('handles special characters in event data', () => {
    const event = createTestEvent({
      properties: {
        message: 'Hello "World" <script>alert(1)</script>',
        emoji: '🎉',
        unicode: '日本語',
      },
    });

    queueOfflineEvents([event]);
    const queued = getOfflineEvents();

    expect(queued[0].properties.message).toBe(
      'Hello "World" <script>alert(1)</script>'
    );
    expect(queued[0].properties.emoji).toBe('🎉');
    expect(queued[0].properties.unicode).toBe('日本語');
  });

  test('handles concurrent send calls', async () => {
    const mockSendBeacon = mock(() => true);
    (globalThis as Record<string, unknown>).navigator = createMockNavigator({
      sendBeacon: mockSendBeacon,
    });
    resetCapabilityCache();

    const batch = createTestBatch();

    // Send multiple requests concurrently
    await Promise.all([
      send('https://api.example.com/events', batch),
      send('https://api.example.com/events', batch),
      send('https://api.example.com/events', batch),
    ]);

    expect(mockSendBeacon).toHaveBeenCalledTimes(3);
  });

  test('setDebugMode enables/disables debug logging', () => {
    // Should not throw
    setDebugMode(true);
    setDebugMode(false);
  });
});
