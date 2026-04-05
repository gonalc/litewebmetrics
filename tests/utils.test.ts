import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  parseQueryString,
  getUtmParams,
  getConnectionInfo,
  getConnectionType,
  isBot,
  debounce,
  throttle,
  supportsBeacon,
  supportsFetch,
  supportsCompression,
  resetCapabilityCache,
  sanitizeEventName,
  sanitizeProperties,
  getPageUrl,
  getPageTitle,
  getReferrer,
  getUserAgent,
  getScreenDimensions,
} from '../src/utils';

// =============================================================================
// Mock Setup
// =============================================================================

let originalNavigator: Navigator | undefined;
let originalWindow: Window | undefined;
let originalDocument: Document | undefined;

beforeEach(() => {
  resetCapabilityCache();
  originalNavigator = (globalThis as Record<string, unknown>).navigator as Navigator | undefined;
  originalWindow = (globalThis as Record<string, unknown>).window as Window | undefined;
  originalDocument = (globalThis as Record<string, unknown>).document as Document | undefined;
});

afterEach(() => {
  if (originalNavigator !== undefined) {
    (globalThis as Record<string, unknown>).navigator = originalNavigator;
  }
  if (originalWindow !== undefined) {
    (globalThis as Record<string, unknown>).window = originalWindow;
  }
  if (originalDocument !== undefined) {
    (globalThis as Record<string, unknown>).document = originalDocument;
  }
});

// =============================================================================
// parseQueryString Tests
// =============================================================================

describe('parseQueryString', () => {
  test('parses simple query string', () => {
    const result = parseQueryString('?foo=bar&baz=qux');
    expect(result).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('parses query string without leading ?', () => {
    const result = parseQueryString('foo=bar&baz=qux');
    expect(result).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('handles empty string', () => {
    expect(parseQueryString('')).toEqual({});
  });

  test('handles just ?', () => {
    expect(parseQueryString('?')).toEqual({});
  });

  test('handles single parameter', () => {
    const result = parseQueryString('?key=value');
    expect(result).toEqual({ key: 'value' });
  });

  test('handles URL-encoded values', () => {
    const result = parseQueryString('?name=John%20Doe&city=New%20York');
    expect(result).toEqual({ name: 'John Doe', city: 'New York' });
  });

  test('handles URL-encoded special characters', () => {
    const result = parseQueryString('?q=%26%3D%3F');
    expect(result).toEqual({ q: '&=?' });
  });

  test('handles empty values', () => {
    const result = parseQueryString('?key=&other=value');
    expect(result).toEqual({ key: '', other: 'value' });
  });

  test('handles value with equals sign', () => {
    const result = parseQueryString('?equation=a=b=c');
    expect(result).toEqual({ equation: 'a=b=c' });
  });

  test('handles malformed input gracefully', () => {
    const result = parseQueryString('?&&&');
    expect(result).toEqual({});
  });

  test('handles duplicate keys (last wins)', () => {
    const result = parseQueryString('?key=first&key=second');
    expect(result.key).toBe('second');
  });
});

// =============================================================================
// getUtmParams Tests
// =============================================================================

describe('getUtmParams', () => {
  test('extracts all UTM parameters', () => {
    (globalThis as Record<string, unknown>).window = {
      location: {
        search: '?utm_source=google&utm_medium=cpc&utm_campaign=summer&utm_term=analytics&utm_content=banner',
        hash: '',
      },
    };

    const result = getUtmParams();
    expect(result).toEqual({
      source: 'google',
      medium: 'cpc',
      campaign: 'summer',
      term: 'analytics',
      content: 'banner',
    });
  });

  test('handles partial UTM parameters', () => {
    (globalThis as Record<string, unknown>).window = {
      location: {
        search: '?utm_source=newsletter&utm_medium=email',
        hash: '',
      },
    };

    const result = getUtmParams();
    expect(result).toEqual({
      source: 'newsletter',
      medium: 'email',
    });
  });

  test('returns empty object when no UTM params', () => {
    (globalThis as Record<string, unknown>).window = {
      location: {
        search: '?page=1&sort=date',
        hash: '',
      },
    };

    const result = getUtmParams();
    expect(result).toEqual({});
  });

  test('returns empty object when no search string', () => {
    (globalThis as Record<string, unknown>).window = {
      location: {
        search: '',
        hash: '',
      },
    };

    const result = getUtmParams();
    expect(result).toEqual({});
  });

  test('handles hash-based routing', () => {
    (globalThis as Record<string, unknown>).window = {
      location: {
        search: '',
        hash: '#/page?utm_source=twitter&utm_medium=social',
      },
    };

    const result = getUtmParams();
    expect(result).toEqual({
      source: 'twitter',
      medium: 'social',
    });
  });

  test('decodes URL-encoded UTM values', () => {
    (globalThis as Record<string, unknown>).window = {
      location: {
        search: '?utm_campaign=Summer%20Sale%202024',
        hash: '',
      },
    };

    const result = getUtmParams();
    expect(result.campaign).toBe('Summer Sale 2024');
  });

  test('returns empty object when window undefined', () => {
    delete (globalThis as Record<string, unknown>).window;
    const result = getUtmParams();
    expect(result).toEqual({});
  });
});

// =============================================================================
// getConnectionInfo Tests
// =============================================================================

describe('getConnectionInfo', () => {
  test('returns null when API not available', () => {
    (globalThis as Record<string, unknown>).navigator = {};
    const result = getConnectionInfo();
    expect(result).toBeNull();
  });

  test('returns connection info when available', () => {
    (globalThis as Record<string, unknown>).navigator = {
      connection: {
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
      },
    };

    const result = getConnectionInfo();
    expect(result).toEqual({
      effectiveType: '4g',
      downlink: 10,
      rtt: 50,
      saveData: false,
    });
  });

  test('handles partial connection info', () => {
    (globalThis as Record<string, unknown>).navigator = {
      connection: {
        effectiveType: '3g',
      },
    };

    const result = getConnectionInfo();
    expect(result?.effectiveType).toBe('3g');
  });

  test('handles mozConnection (Firefox)', () => {
    (globalThis as Record<string, unknown>).navigator = {
      mozConnection: {
        effectiveType: '4g',
      },
    };

    const result = getConnectionInfo();
    expect(result?.effectiveType).toBe('4g');
  });

  test('handles webkitConnection', () => {
    (globalThis as Record<string, unknown>).navigator = {
      webkitConnection: {
        effectiveType: '2g',
      },
    };

    const result = getConnectionInfo();
    expect(result?.effectiveType).toBe('2g');
  });
});

// =============================================================================
// getConnectionType Tests
// =============================================================================

describe('getConnectionType', () => {
  test('returns unknown when API not available', () => {
    (globalThis as Record<string, unknown>).navigator = {};
    expect(getConnectionType()).toBe('unknown');
  });

  test('returns correct connection types', () => {
    const types = ['slow-2g', '2g', '3g', '4g'] as const;

    for (const type of types) {
      (globalThis as Record<string, unknown>).navigator = {
        connection: { effectiveType: type },
      };
      expect(getConnectionType()).toBe(type);
    }
  });

  test('returns unknown for invalid type', () => {
    (globalThis as Record<string, unknown>).navigator = {
      connection: { effectiveType: '5g' },
    };
    expect(getConnectionType()).toBe('unknown');
  });
});

// =============================================================================
// isBot Tests
// =============================================================================

describe('isBot', () => {
  test('detects Googlebot', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    };
    expect(isBot()).toBe(true);
  });

  test('detects Bingbot', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    };
    expect(isBot()).toBe(true);
  });

  test('detects headless Chrome', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/91.0',
    };
    expect(isBot()).toBe(true);
  });

  test('detects Puppeteer', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 Puppeteer/1.0',
    };
    expect(isBot()).toBe(true);
  });

  test('detects curl', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'curl/7.68.0',
    };
    expect(isBot()).toBe(true);
  });

  test('detects Python requests', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'python-requests/2.25.1',
    };
    expect(isBot()).toBe(true);
  });

  test('detects webdriver property', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0',
      webdriver: true,
    };
    expect(isBot()).toBe(true);
  });

  test('does not flag Chrome browser', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124',
    };
    expect(isBot()).toBe(false);
  });

  test('does not flag Firefox browser', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    };
    expect(isBot()).toBe(false);
  });

  test('does not flag Safari browser', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    };
    expect(isBot()).toBe(false);
  });

  test('case insensitive matching', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 (compatible; GOOGLEBOT/2.1)',
    };
    expect(isBot()).toBe(true);
  });

  test('returns false when navigator undefined', () => {
    delete (globalThis as Record<string, unknown>).navigator;
    expect(isBot()).toBe(false);
  });

  test('returns false for empty user agent', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: '',
    };
    expect(isBot()).toBe(false);
  });
});

// =============================================================================
// debounce Tests
// =============================================================================

describe('debounce', () => {
  test('delays function execution', async () => {
    let callCount = 0;
    const fn = () => { callCount++; };
    const debounced = debounce(fn, 50);

    debounced();
    debounced();
    debounced();

    expect(callCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(callCount).toBe(1);
  });

  test('passes arguments to function', async () => {
    let receivedArgs: unknown[] = [];
    const fn = (...args: unknown[]) => { receivedArgs = args; };
    const debounced = debounce(fn, 50);

    debounced('a', 'b', 'c');

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedArgs).toEqual(['a', 'b', 'c']);
  });

  test('uses last arguments when called multiple times', async () => {
    let receivedValue: unknown;
    const fn = (value: unknown) => { receivedValue = value; };
    const debounced = debounce(fn, 50);

    debounced('first');
    debounced('second');
    debounced('third');

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedValue).toBe('third');
  });

  test('resets timer on each call', async () => {
    let callCount = 0;
    const fn = () => { callCount++; };
    const debounced = debounce(fn, 50);

    debounced();
    await new Promise((resolve) => setTimeout(resolve, 30));
    debounced();
    await new Promise((resolve) => setTimeout(resolve, 30));
    debounced();

    expect(callCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(callCount).toBe(1);
  });
});

// =============================================================================
// throttle Tests
// =============================================================================

describe('throttle', () => {
  test('executes immediately on first call', () => {
    let callCount = 0;
    const fn = () => { callCount++; };
    const throttled = throttle(fn, 100);

    throttled();

    expect(callCount).toBe(1);
  });

  test('limits call rate', async () => {
    let callCount = 0;
    const fn = () => { callCount++; };
    const throttled = throttle(fn, 50);

    throttled();
    throttled();
    throttled();

    expect(callCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have executed once more with last args
    expect(callCount).toBe(2);
  });

  test('passes arguments to function', () => {
    let receivedArgs: unknown[] = [];
    const fn = (...args: unknown[]) => { receivedArgs = args; };
    const throttled = throttle(fn, 100);

    throttled('a', 'b', 'c');

    expect(receivedArgs).toEqual(['a', 'b', 'c']);
  });

  test('executes with last arguments after throttle period', async () => {
    const calls: unknown[] = [];
    const fn = (value: unknown) => { calls.push(value); };
    const throttled = throttle(fn, 50);

    throttled('first');
    throttled('second');
    throttled('third');

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls).toEqual(['first', 'third']);
  });
});

// =============================================================================
// Browser Capability Tests
// =============================================================================

describe('supportsBeacon', () => {
  test('returns true when sendBeacon available', () => {
    (globalThis as Record<string, unknown>).navigator = {
      sendBeacon: () => true,
    };
    resetCapabilityCache();
    expect(supportsBeacon()).toBe(true);
  });

  test('returns false when sendBeacon not available', () => {
    (globalThis as Record<string, unknown>).navigator = {};
    resetCapabilityCache();
    expect(supportsBeacon()).toBe(false);
  });

  test('caches result', () => {
    (globalThis as Record<string, unknown>).navigator = {
      sendBeacon: () => true,
    };
    resetCapabilityCache();

    const result1 = supportsBeacon();
    (globalThis as Record<string, unknown>).navigator = {};
    const result2 = supportsBeacon();

    expect(result1).toBe(true);
    expect(result2).toBe(true); // Still true from cache
  });
});

describe('supportsFetch', () => {
  test('returns true when fetch available', () => {
    resetCapabilityCache();
    expect(supportsFetch()).toBe(true); // Bun has fetch
  });
});

describe('supportsCompression', () => {
  test('returns boolean', () => {
    resetCapabilityCache();
    const result = supportsCompression();
    expect(typeof result).toBe('boolean');
  });
});

// =============================================================================
// sanitizeEventName Tests
// =============================================================================

describe('sanitizeEventName', () => {
  test('converts to lowercase', () => {
    expect(sanitizeEventName('PageView')).toBe('pageview');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeEventName('button click')).toBe('button_click');
  });

  test('removes special characters', () => {
    expect(sanitizeEventName('event@name#123!')).toBe('eventname123');
  });

  test('limits length to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(sanitizeEventName(longName).length).toBe(100);
  });

  test('handles empty string', () => {
    expect(sanitizeEventName('')).toBe('unknown_event');
  });

  test('handles whitespace-only string', () => {
    expect(sanitizeEventName('   ')).toBe('unknown_event');
  });

  test('handles non-string input', () => {
    expect(sanitizeEventName(null as unknown as string)).toBe('unknown_event');
    expect(sanitizeEventName(undefined as unknown as string)).toBe('unknown_event');
    expect(sanitizeEventName(123 as unknown as string)).toBe('unknown_event');
  });

  test('trims whitespace', () => {
    expect(sanitizeEventName('  button_click  ')).toBe('button_click');
  });

  test('handles multiple spaces', () => {
    // Multiple consecutive spaces are collapsed to single underscore
    expect(sanitizeEventName('button   click   event')).toBe('button_click_event');
  });

  test('preserves underscores', () => {
    expect(sanitizeEventName('button_click_event')).toBe('button_click_event');
  });
});

// =============================================================================
// sanitizeProperties Tests
// =============================================================================

describe('sanitizeProperties', () => {
  test('passes through simple properties', () => {
    const props = { name: 'John', age: 30, active: true };
    expect(sanitizeProperties(props)).toEqual(props);
  });

  test('removes undefined values', () => {
    const props = { name: 'John', age: undefined };
    const result = sanitizeProperties(props);
    expect(result).toEqual({ name: 'John' });
  });

  test('converts null to null', () => {
    const props = { value: null };
    expect(sanitizeProperties(props)).toEqual({ value: null });
  });

  test('converts Dates to ISO strings', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    const props = { created: date };
    expect(sanitizeProperties(props)).toEqual({ created: '2024-01-15T10:30:00.000Z' });
  });

  test('limits string length', () => {
    const longString = 'x'.repeat(2000);
    const props = { text: longString };
    const result = sanitizeProperties(props);
    expect((result.text as string).length).toBe(1000);
  });

  test('handles NaN', () => {
    const props = { value: NaN };
    expect(sanitizeProperties(props)).toEqual({ value: null });
  });

  test('handles Infinity', () => {
    const props = { value: Infinity };
    expect(sanitizeProperties(props)).toEqual({ value: null });
  });

  test('handles nested objects', () => {
    const props = {
      user: {
        name: 'John',
        email: 'john@example.com',
      },
    };
    expect(sanitizeProperties(props)).toEqual(props);
  });

  test('limits object depth', () => {
    const props = {
      a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } },
    };
    const result = sanitizeProperties(props);
    expect((result as Record<string, unknown>).a).toBeDefined();
  });

  test('handles arrays', () => {
    const props = { items: [1, 2, 3] };
    expect(sanitizeProperties(props)).toEqual({ items: [1, 2, 3] });
  });

  test('handles empty object', () => {
    expect(sanitizeProperties({})).toEqual({});
  });

  test('handles null input', () => {
    expect(sanitizeProperties(null as unknown as Record<string, unknown>)).toEqual({});
  });

  test('handles array input', () => {
    expect(sanitizeProperties([] as unknown as Record<string, unknown>)).toEqual({});
  });

  test('handles functions in properties', () => {
    const props = { callback: () => {} };
    expect(sanitizeProperties(props)).toEqual({ callback: null });
  });

  test('limits number of keys', () => {
    const props: Record<string, number> = {};
    for (let i = 0; i < 150; i++) {
      props[`key${i}`] = i;
    }
    const result = sanitizeProperties(props);
    expect(Object.keys(result).length).toBe(100);
  });
});

// =============================================================================
// Page Context Tests
// =============================================================================

describe('getPageUrl', () => {
  test('returns URL when available', () => {
    (globalThis as Record<string, unknown>).window = {
      location: { href: 'https://example.com/page' },
    };
    expect(getPageUrl()).toBe('https://example.com/page');
  });

  test('returns empty string when not available', () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(getPageUrl()).toBe('');
  });
});

describe('getPageTitle', () => {
  test('returns title when available', () => {
    (globalThis as Record<string, unknown>).document = {
      title: 'My Page Title',
    };
    expect(getPageTitle()).toBe('My Page Title');
  });

  test('returns undefined when not available', () => {
    delete (globalThis as Record<string, unknown>).document;
    expect(getPageTitle()).toBeUndefined();
  });
});

describe('getReferrer', () => {
  test('returns referrer when available', () => {
    (globalThis as Record<string, unknown>).document = {
      referrer: 'https://google.com',
    };
    expect(getReferrer()).toBe('https://google.com');
  });

  test('returns undefined when not available', () => {
    delete (globalThis as Record<string, unknown>).document;
    expect(getReferrer()).toBeUndefined();
  });
});

describe('getUserAgent', () => {
  test('returns user agent when available', () => {
    (globalThis as Record<string, unknown>).navigator = {
      userAgent: 'Mozilla/5.0 Test',
    };
    expect(getUserAgent()).toBe('Mozilla/5.0 Test');
  });

  test('returns empty string when not available', () => {
    delete (globalThis as Record<string, unknown>).navigator;
    expect(getUserAgent()).toBe('');
  });
});

describe('getScreenDimensions', () => {
  test('returns dimensions when available', () => {
    (globalThis as Record<string, unknown>).window = {
      screen: { width: 1920, height: 1080 },
    };
    expect(getScreenDimensions()).toEqual({ width: 1920, height: 1080 });
  });

  test('returns zeros when not available', () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(getScreenDimensions()).toEqual({ width: 0, height: 0 });
  });
});
