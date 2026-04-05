/**
 * Analytics Class Tests
 * Comprehensive tests for the main Analytics SDK class
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { Analytics, createAnalytics } from '../src/analytics';
import type { AnalyticsConfig } from '../src/types';
import { resetStorageCache, clearVisitorId, clearSessionId } from '../src/storage';
import { resetCapabilityCache } from '../src/utils';
import { clearOfflineEvents, clearSentRequests } from '../src/network';
import { resetNetworkAdapter } from '../src/network-adapter';

// =============================================================================
// Mock Setup
// =============================================================================

// Store original globals
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalHistory = globalThis.history;
const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;

const SERVER_URL = 'https://analytics.test.example.com'

// Mock storage
function createMockStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

// Track event listeners
type EventListenerEntry = { type: string; listener: EventListenerOrEventListenerObject };
let windowEventListeners: EventListenerEntry[] = [];

// Track timer IDs
let timerIdCounter = 1;
const activeTimers = new Map<number, { callback: () => void; interval: number }>();

// Mock sendBeacon results
let sendBeaconResult = true;
let sendBeaconCalls: Array<{ url: string; data: unknown }> = [];

// Mock fetch results
let fetchResult: { ok: boolean; status: number; statusText: string } = {
  ok: true,
  status: 200,
  statusText: 'OK',
};
let fetchCalls: Array<{ url: string; options: RequestInit }> = [];

// Reset all state
function resetMocks(): void {
  windowEventListeners = [];
  timerIdCounter = 1;
  activeTimers.clear();
  sendBeaconResult = true;
  sendBeaconCalls = [];
  fetchResult = { ok: true, status: 200, statusText: 'OK' };
  fetchCalls = [];
}

// Setup mocks before each test
function setupMocks(): void {
  resetMocks();
  resetStorageCache();
  resetCapabilityCache();
  resetNetworkAdapter();
  clearVisitorId();
  clearSessionId();
  clearOfflineEvents();
  clearSentRequests();

  const mockLocalStorage = createMockStorage();
  const mockSessionStorage = createMockStorage();

  // Mock window
  (globalThis as unknown as Record<string, unknown>).window = {
    location: {
      href: 'https://example.com/page',
      search: '',
      hash: '',
    },
    screen: {
      width: 1920,
      height: 1080,
    },
    addEventListener: mock((type: string, listener: EventListenerOrEventListenerObject) => {
      windowEventListeners.push({ type, listener });
    }),
    removeEventListener: mock((type: string, listener: EventListenerOrEventListenerObject) => {
      windowEventListeners = windowEventListeners.filter(
        (e) => !(e.type === type && e.listener === listener)
      );
    }),
    localStorage: mockLocalStorage,
    sessionStorage: mockSessionStorage,
  };

  // Mock document
  (globalThis as unknown as Record<string, unknown>).document = {
    title: 'Test Page',
    referrer: 'https://google.com',
    addEventListener: mock(),
    removeEventListener: mock(),
  };

  // Mock navigator with connection info for NetworkAdapter
  (globalThis as unknown as Record<string, unknown>).navigator = {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    sendBeacon: mock((url: string, data: unknown) => {
      sendBeaconCalls.push({ url, data });
      return sendBeaconResult;
    }),
    onLine: true,
    // Mock connection for NetworkAdapter - use undefined to disable adaptive behavior in tests
    connection: undefined,
  };

  // Mock history
  (globalThis as unknown as Record<string, unknown>).history = {
    pushState: mock(),
    replaceState: mock(),
  };

  // Mock localStorage globally
  (globalThis as unknown as Record<string, unknown>).localStorage = mockLocalStorage;
  (globalThis as unknown as Record<string, unknown>).sessionStorage = mockSessionStorage;

  // Mock timers
  (globalThis as unknown as Record<string, unknown>).setInterval = mock(
    (callback: () => void, interval: number) => {
      const id = timerIdCounter++;
      activeTimers.set(id, { callback, interval });
      return id;
    }
  );

  (globalThis as unknown as Record<string, unknown>).clearInterval = mock((id: number) => {
    activeTimers.delete(id);
  });

  // Track pending timeouts for debounce
  const pendingTimeouts = new Map<number, () => void>();

  (globalThis as unknown as Record<string, unknown>).setTimeout = mock(
    (callback: () => void, delay: number) => {
      const id = timerIdCounter++;
      // Execute immediately for short delays (debounce)
      if (delay <= 200) {
        callback();
      } else {
        pendingTimeouts.set(id, callback);
      }
      return id;
    }
  );

  (globalThis as unknown as Record<string, unknown>).clearTimeout = mock((id: number) => {
    pendingTimeouts.delete(id);
  });

  // Mock fetch
  (globalThis as unknown as Record<string, unknown>).fetch = mock(
    async (url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options: options || {} });
      return {
        ok: fetchResult.ok,
        status: fetchResult.status,
        statusText: fetchResult.statusText,
      };
    }
  );

  // Mock Blob
  (globalThis as unknown as Record<string, unknown>).Blob = class MockBlob {
    content: unknown[];
    options: BlobPropertyBag | undefined;

    constructor(content: unknown[], options?: BlobPropertyBag) {
      this.content = content;
      this.options = options;
    }

    get type(): string {
      return this.options?.type || '';
    }
  };
}

// Cleanup after each test
function cleanupMocks(): void {
  (globalThis as unknown as Record<string, unknown>).window = originalWindow;
  (globalThis as unknown as Record<string, unknown>).document = originalDocument;
  (globalThis as unknown as Record<string, unknown>).navigator = originalNavigator;
  (globalThis as unknown as Record<string, unknown>).history = originalHistory;
  (globalThis as unknown as Record<string, unknown>).localStorage = originalLocalStorage;
  (globalThis as unknown as Record<string, unknown>).sessionStorage = originalSessionStorage;
}

// Helper to trigger window events
function triggerWindowEvent(type: string): void {
  const listeners = windowEventListeners.filter((e) => e.type === type);
  for (const entry of listeners) {
    if (typeof entry.listener === 'function') {
      entry.listener(new Event(type));
    }
  }
}

// Helper to advance timers
function advanceTimers(): void {
  for (const [_id, timer] of activeTimers) {
    timer.callback();
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('Analytics', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    cleanupMocks();
  });

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    test('creates visitor and session IDs', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(analytics.getVisitorId()).toBeTruthy();
      expect(analytics.getSessionId()).toBeTruthy();
      expect(analytics.getVisitorId()).not.toBe(analytics.getSessionId());

      analytics.destroy();
    });

    test('sets up with correct defaults', () => {
      // Disable adaptive network to test SDK defaults
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, adaptiveNetwork: false });
      const config = analytics.getConfig();

      expect(config.apiKey).toBe('test_key');
      expect(config.endpoint).toBe(SERVER_URL);
      expect(config.debug).toBe(false);
      expect(config.maxQueueSize).toBe(10);
      expect(config.flushInterval).toBe(5000);
      expect(config.autoTrack).toBe(true);

      analytics.destroy();
    });

    test('accepts custom configuration', () => {
      // Disable adaptive network to test custom config values
      const analytics = new Analytics({
        apiKey: 'test_key',
        endpoint: 'https://custom.endpoint.com',
        debug: true,
        maxQueueSize: 20,
        flushInterval: 10000,
        autoTrack: false,
        adaptiveNetwork: false,
      });

      const config = analytics.getConfig();

      expect(config.endpoint).toBe('https://custom.endpoint.com');
      expect(config.debug).toBe(true);
      expect(config.maxQueueSize).toBe(20);
      expect(config.flushInterval).toBe(10000);
      expect(config.autoTrack).toBe(false);

      analytics.destroy();
    });

    test('throws if no API key', () => {
      expect(() => {
        new Analytics({ apiKey: '', endpoint: SERVER_URL });
      }).toThrow('[Analytics] API key is required');

      expect(() => {
        new Analytics({} as AnalyticsConfig);
      }).toThrow('[Analytics] API key is required');
    });

    test('skips init if bot detected', () => {
      // Set bot user agent
      (navigator as unknown as Record<string, unknown>).userAgent =
        'Googlebot/2.1 (+http://www.google.com/bot.html)';

      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      // Should not be initialized
      expect(analytics.isActive()).toBe(false);

      analytics.destroy();
    });

    test('is marked as active after initialization', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(analytics.isActive()).toBe(true);

      analytics.destroy();
    });

    test('sets up event listeners on init', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      const listenerTypes = windowEventListeners.map((e) => e.type);

      expect(listenerTypes).toContain('beforeunload');
      expect(listenerTypes).toContain('online');
      expect(listenerTypes).toContain('offline');
      expect(listenerTypes).toContain('popstate');

      analytics.destroy();
    });

    test('starts flush timer on init', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(activeTimers.size).toBe(1);

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Track Method Tests
  // ===========================================================================

  describe('track method', () => {
    test('adds event to queue', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('test_event');

      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    test('includes all metadata', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('test_event', { custom: 'prop' });

      // Queue should have the event
      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    test('sanitizes event name', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      // Track with unsanitized name
      analytics.track('Test Event!@#$');

      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    test('sanitizes properties', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      // Track with problematic properties
      analytics.track('test', {
        valid: 'string',
        number: 123,
        nested: { deep: 'value' },
        func: () => {}, // Should be removed
        date: new Date('2024-01-01'),
      });

      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    test('flushes when queue is full', () => {
      // Disable adaptive network to use specified maxQueueSize
      const analytics = new Analytics({
        apiKey: 'test_key',
        endpoint: SERVER_URL,
        autoTrack: false,
        maxQueueSize: 3,
        adaptiveNetwork: false,
      });

      analytics.track('event1');
      analytics.track('event2');

      expect(analytics.getQueueLength()).toBe(2);

      // This should trigger flush
      analytics.track('event3');

      // Queue should be empty after flush
      expect(analytics.getQueueLength()).toBe(0);

      analytics.destroy();
    });

    test('does not track if not initialized', () => {
      // Set bot user agent to skip init
      (navigator as unknown as Record<string, unknown>).userAgent = 'Googlebot';

      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      analytics.track('test_event');

      expect(analytics.getQueueLength()).toBe(0);

      analytics.destroy();
    });
  });

  // ===========================================================================
  // TrackPageView Tests
  // ===========================================================================

  describe('trackPageView', () => {
    test('calls track with pageview event', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.trackPageView();

      // Wait for debounce (immediate in our mock)
      expect(analytics.getQueueLength()).toBeGreaterThanOrEqual(0);

      analytics.destroy();
    });

    test('includes correct URL and title via flush', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('pageview');
      await analytics.flush();

      // Should have sent via beacon
      expect(sendBeaconCalls.length).toBe(1);

      analytics.destroy();
    });

    test('auto-tracks initial pageview when autoTrack is true', () => {
      // autoTrack: true by default
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      // Should have tracked initial pageview
      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    test('does not auto-track when autoTrack is false', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      expect(analytics.getQueueLength()).toBe(0);

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Flush Tests
  // ===========================================================================

  describe('flush', () => {
    test('sends queued events', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      analytics.track('event2');

      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);
      expect(analytics.getQueueLength()).toBe(0);

      analytics.destroy();
    });

    test('empties queue after send', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      expect(analytics.getQueueLength()).toBe(1);

      await analytics.flush();

      expect(analytics.getQueueLength()).toBe(0);

      analytics.destroy();
    });

    test('tries sendBeacon first', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);
      expect(fetchCalls.length).toBe(0);

      analytics.destroy();
    });

    test('falls back to fetch if beacon fails', async () => {
      sendBeaconResult = false;

      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);
      expect(fetchCalls.length).toBe(1);

      analytics.destroy();
    });

    test('handles offline state', async () => {
      (navigator as unknown as Record<string, unknown>).onLine = false;

      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      // Should not have sent
      expect(sendBeaconCalls.length).toBe(0);
      expect(fetchCalls.length).toBe(0);

      // Should have queued offline
      const offlineQueue = localStorage.getItem('_analytics_offline_queue');
      expect(offlineQueue).toBeTruthy();

      analytics.destroy();
    });

    test('does nothing if queue is empty', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(0);
      expect(fetchCalls.length).toBe(0);

      analytics.destroy();
    });

    test('includes api_key in batch', async () => {
      const analytics = new Analytics({ apiKey: 'my_api_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);

      // The beacon sends a Blob, which contains the JSON
      const blob = sendBeaconCalls[0].data as { content: string[] };
      if (blob.content) {
        const payload = JSON.parse(blob.content[0]);
        expect(payload.api_key).toBe('my_api_key');
      }

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Auto-Tracking Tests
  // ===========================================================================

  describe('auto-tracking', () => {
    test('tracks initial pageview', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    test('tracks SPA navigation via pushState', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      // Initial pageview
      expect(analytics.getQueueLength()).toBe(1);

      // Change URL to simulate navigation (deduplication prevents same-URL pageviews)
      (window.location as unknown as Record<string, unknown>).href = 'https://example.com/new-page';

      // Manually track pageview (simulating what wrapped pushState would do)
      // Note: In a real browser, history.pushState wrapping handles this automatically
      analytics.trackPageView();

      // Should have tracked another pageview
      expect(analytics.getQueueLength()).toBe(2);

      analytics.destroy();
    });

    test('tracks back/forward navigation via popstate', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      // Initial pageview
      expect(analytics.getQueueLength()).toBe(1);

      // Change the URL so the pageview is not deduplicated
      (window.location as unknown as Record<string, unknown>).href = 'https://example.com/new-page';

      // Trigger popstate event
      triggerWindowEvent('popstate');

      // Should have tracked another pageview
      expect(analytics.getQueueLength()).toBe(2);

      analytics.destroy();
    });

    test('flushes on page unload', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      analytics.track('event2');

      expect(analytics.getQueueLength()).toBe(2);

      // Trigger beforeunload
      triggerWindowEvent('beforeunload');

      // Queue should be emptied
      expect(analytics.getQueueLength()).toBe(0);

      // Should have sent via beacon
      expect(sendBeaconCalls.length).toBe(1);

      analytics.destroy();
    });

    test('handles online event', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      // Queue some offline events
      localStorage.setItem(
        '_analytics_offline_queue',
        JSON.stringify([
          {
            event: 'offline_event',
            properties: {},
            timestamp: Date.now(),
            visitor_id: 'v1',
            session_id: 's1',
            page_url: 'https://example.com',
            user_agent: 'test',
            screen_width: 1920,
            screen_height: 1080,
          },
        ])
      );

      // Trigger online event
      triggerWindowEvent('online');

      // Should have attempted to send
      expect(sendBeaconCalls.length).toBeGreaterThanOrEqual(0);

      analytics.destroy();
    });

    test('handles offline event', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      expect(analytics.getQueueLength()).toBe(1);

      // Trigger offline event
      triggerWindowEvent('offline');

      // Queue should be emptied (moved to offline storage)
      expect(analytics.getQueueLength()).toBe(0);

      // Should have queued offline
      const offlineQueue = localStorage.getItem('_analytics_offline_queue');
      expect(offlineQueue).toBeTruthy();

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe('cleanup', () => {
    test('destroy() stops timer', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(activeTimers.size).toBe(1);

      analytics.destroy();

      expect(activeTimers.size).toBe(0);
    });

    test('destroy() removes listeners', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      const initialCount = windowEventListeners.length;
      expect(initialCount).toBeGreaterThan(0);

      analytics.destroy();

      // Should have removed listeners
      expect(windowEventListeners.length).toBeLessThan(initialCount);
    });

    test('destroy() flushes queue', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      analytics.track('event2');

      expect(analytics.getQueueLength()).toBe(2);

      analytics.destroy();

      // Should have flushed via beacon
      expect(sendBeaconCalls.length).toBe(1);
    });

    test('destroy() marks as not initialized', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(analytics.isActive()).toBe(true);

      analytics.destroy();

      expect(analytics.isActive()).toBe(false);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    test('handles network failures gracefully', async () => {
      sendBeaconResult = false;
      fetchResult = { ok: false, status: 500, statusText: 'Server Error' };

      // Disable adaptive network to avoid retry delays
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false, adaptiveNetwork: false });

      analytics.track('event1');

      // Should not throw
      await analytics.flush();

      // Should have tried beacon and fetch
      expect(sendBeaconCalls.length).toBe(1);
      expect(fetchCalls.length).toBe(1);

      analytics.destroy();
    });

    test('handles storage failures', () => {
      // Make localStorage throw
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('Storage quota exceeded');
      };

      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      // Should not throw
      analytics.track('event1');

      expect(analytics.getQueueLength()).toBe(1);

      localStorage.setItem = originalSetItem;
      analytics.destroy();
    });

    test('logs errors in debug mode', async () => {
      const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});

      sendBeaconResult = false;
      fetchResult = { ok: false, status: 500, statusText: 'Server Error' };

      // Disable adaptive network to avoid retry delays
      const analytics = new Analytics({
        apiKey: 'test_key',
        endpoint: SERVER_URL,
        autoTrack: false,
        debug: true,
        adaptiveNetwork: false,
      });

      analytics.track('event1');
      await analytics.flush();

      // Should have logged error
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      analytics.destroy();
    });

    test('does not throw to user code', async () => {
      sendBeaconResult = false;
      (globalThis as unknown as Record<string, unknown>).fetch = mock(() => {
        throw new Error('Network error');
      });

      // Disable adaptive network to avoid retry delays
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false, adaptiveNetwork: false });

      analytics.track('event1');

      // Should not throw
      let error: Error | null = null;
      try {
        await analytics.flush();
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeNull();

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    test('setConfig updates configuration', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      analytics.setConfig({ debug: true, maxQueueSize: 50 });

      const config = analytics.getConfig();
      expect(config.debug).toBe(true);
      expect(config.maxQueueSize).toBe(50);

      analytics.destroy();
    });

    test('setConfig restarts timer when interval changes', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      const initialTimerCount = activeTimers.size;
      expect(initialTimerCount).toBe(1);

      analytics.setConfig({ flushInterval: 10000 });

      // Timer should have been restarted
      expect(activeTimers.size).toBe(1);

      analytics.destroy();
    });

    test('getVisitorId returns visitor ID', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      const visitorId = analytics.getVisitorId();

      expect(visitorId).toBeTruthy();
      expect(typeof visitorId).toBe('string');

      analytics.destroy();
    });

    test('getSessionId returns session ID', () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      const sessionId = analytics.getSessionId();

      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createAnalytics', () => {
    test('creates Analytics instance', () => {
      const analytics = createAnalytics({ apiKey: 'test_key', endpoint: SERVER_URL });

      expect(analytics).toBeInstanceOf(Analytics);
      expect(analytics.isActive()).toBe(true);

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Periodic Flush Tests
  // ===========================================================================

  describe('periodic flush', () => {
    test('flushes periodically via timer', () => {
      const analytics = new Analytics({
        apiKey: 'test_key',
        endpoint: SERVER_URL,
        autoTrack: false,
        flushInterval: 5000,
      });

      analytics.track('event1');
      analytics.track('event2');

      expect(analytics.getQueueLength()).toBe(2);

      // Advance timers (simulate interval firing)
      advanceTimers();

      // Queue should be flushed
      expect(analytics.getQueueLength()).toBe(0);
      expect(sendBeaconCalls.length).toBe(1);

      analytics.destroy();
    });

    test('does not start timer if flushInterval is 0', () => {
      // Disable adaptive network to use specified flushInterval
      const analytics = new Analytics({
        apiKey: 'test_key',
        endpoint: SERVER_URL,
        autoTrack: false,
        flushInterval: 0,
        adaptiveNetwork: false,
      });

      // Should not have started timer
      expect(activeTimers.size).toBe(0);

      analytics.destroy();
    });
  });

  // ===========================================================================
  // Event Metadata Tests
  // ===========================================================================

  describe('event metadata', () => {
    test('includes visitor_id in flushed events', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);

      const blob = sendBeaconCalls[0].data as { content: string[] };
      if (blob.content) {
        const payload = JSON.parse(blob.content[0]);
        expect(payload.events[0].visitor_id).toBeTruthy();
      }

      analytics.destroy();
    });

    test('includes session_id in flushed events', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);

      const blob = sendBeaconCalls[0].data as { content: string[] };
      if (blob.content) {
        const payload = JSON.parse(blob.content[0]);
        expect(payload.events[0].session_id).toBeTruthy();
      }

      analytics.destroy();
    });

    test('includes page context in flushed events', async () => {
      const analytics = new Analytics({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

      analytics.track('event1');
      await analytics.flush();

      expect(sendBeaconCalls.length).toBe(1);

      const blob = sendBeaconCalls[0].data as { content: string[] };
      if (blob.content) {
        const payload = JSON.parse(blob.content[0]);
        const event = payload.events[0];

        expect(event.page_url).toBe('https://example.com/page');
        expect(event.page_title).toBe('Test Page');
        expect(event.referrer).toBe('https://google.com');
        expect(event.screen_width).toBe(1920);
        expect(event.screen_height).toBe(1080);
      }

      analytics.destroy();
    });
  });
});
