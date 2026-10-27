/**
 * Core Build Tests
 * Page context capture, sanitizeUrl, visitorId and unload behavior of src/core.ts
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Analytics as Core } from '../src/core';

// =============================================================================
// Mock Setup
// =============================================================================

const SERVER_URL = 'https://analytics.test.example.com';

const GLOBAL_KEYS = [
  'window',
  'document',
  'navigator',
  'location',
  'screen',
  'localStorage',
  'sessionStorage',
  'Blob',
  'setInterval',
  'clearInterval',
] as const;

const g = globalThis as unknown as Record<string, unknown>;
const originals: Record<string, unknown> = {};
for (const key of GLOBAL_KEYS) originals[key] = g[key];

let beaconCalls: unknown[] = [];
let unloadListeners: Array<() => void> = [];

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
      for (const key of Object.keys(store)) delete store[key];
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

function setupMocks(): void {
  beaconCalls = [];
  unloadListeners = [];

  g.window = {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'beforeunload') unloadListeners.push(listener);
    },
  };
  g.location = { href: 'https://example.com/page' };
  g.document = { title: 'Test Page', referrer: '' };
  g.screen = { width: 1920, height: 1080 };
  g.navigator = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    sendBeacon: (_url: string, data: unknown) => {
      beaconCalls.push(data);
      return true;
    },
  };
  g.localStorage = createMockStorage();
  g.sessionStorage = createMockStorage();
  g.Blob = class MockBlob {
    content: unknown[];
    constructor(content: unknown[]) {
      this.content = content;
    }
  };
  g.setInterval = mock(() => 1);
  g.clearInterval = mock();
}

function cleanupMocks(): void {
  for (const key of GLOBAL_KEYS) g[key] = originals[key];
}

function sentEvents(call = 0): Array<Record<string, unknown>> {
  const blob = beaconCalls[call] as { content: string[] };
  return JSON.parse(blob.content[0]).events;
}

function setUrl(href: string): void {
  (g.location as Record<string, unknown>).href = href;
}

// =============================================================================
// Tests
// =============================================================================

describe('Core', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    cleanupMocks();
  });

  test('uses the URL and title at track time, not at flush time', async () => {
    const core = new Core({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

    core.track('event1');
    setUrl('https://example.com/second');
    (g.document as Record<string, unknown>).title = 'Second Page';
    core.track('event2');
    await core.flush();

    const events = sentEvents();
    expect(events[0].page_url).toBe('https://example.com/page');
    expect(events[0].page_title).toBe('Test Page');
    expect(events[1].page_url).toBe('https://example.com/second');
    expect(events[1].page_title).toBe('Second Page');
  });

  test('applies sanitizeUrl once per distinct URL', async () => {
    const sanitizeUrl = mock((u: string) => new URL(u).pathname);
    const core = new Core({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false, sanitizeUrl });

    core.track('event1');
    core.track('event2');
    await core.flush();

    expect(sentEvents()[0].page_url).toBe('/page');
    expect(sanitizeUrl).toHaveBeenCalledTimes(1);
  });

  test('falls back to the raw URL if sanitizeUrl throws or returns a non-string', async () => {
    const throwing = new Core({
      apiKey: 'test_key',
      endpoint: SERVER_URL,
      autoTrack: false,
      sanitizeUrl: () => {
        throw new Error('boom');
      },
    });
    throwing.track('event1');
    await throwing.flush();
    expect(sentEvents(0)[0].page_url).toBe('https://example.com/page');

    const nonString = new Core({
      apiKey: 'test_key',
      endpoint: SERVER_URL,
      autoTrack: false,
      sanitizeUrl: (() => null) as unknown as (url: string) => string,
    });
    nonString.track('event1');
    await nonString.flush();
    expect(sentEvents(1)[0].page_url).toBe('https://example.com/page');
  });

  test('visitorId option overrides the generated ID without storing it', async () => {
    const core = new Core({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false, visitorId: 'native_123' });

    expect(core.getVisitorId()).toBe('native_123');
    expect(localStorage.getItem('_a_vid')).toBeNull();

    core.track('event1');
    await core.flush();
    expect(sentEvents()[0].visitor_id).toBe('native_123');
  });

  test('does not resend events after unload and destroy', async () => {
    const core = new Core({ apiKey: 'test_key', endpoint: SERVER_URL, autoTrack: false });

    core.track('event1');
    for (const listener of unloadListeners) listener();
    core.destroy();
    await core.flush();

    expect(beaconCalls.length).toBe(1);
  });
});
