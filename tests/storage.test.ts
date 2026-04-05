import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  generateId,
  getVisitorId,
  getSessionId,
  getItem,
  setItem,
  getSessionItem,
  setSessionItem,
  isStorageAvailable,
  resetStorageCache,
  clearVisitorId,
  clearSessionId,
  STORAGE_KEYS,
} from '../src/storage';

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

  // Test helpers
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
// Setup and Teardown
// =============================================================================

let mockLocalStorage: MockStorage;
let mockSessionStorage: MockStorage;
let originalLocalStorage: Storage | undefined;
let originalSessionStorage: Storage | undefined;

beforeEach(() => {
  // Create fresh mock storage instances
  mockLocalStorage = new MockStorage();
  mockSessionStorage = new MockStorage();

  // Save originals if they exist
  originalLocalStorage = (globalThis as Record<string, unknown>).localStorage as Storage | undefined;
  originalSessionStorage = (globalThis as Record<string, unknown>).sessionStorage as Storage | undefined;

  // Install mocks
  (globalThis as Record<string, unknown>).localStorage = mockLocalStorage;
  (globalThis as Record<string, unknown>).sessionStorage = mockSessionStorage;

  // Reset storage cache and IDs
  resetStorageCache();
  clearVisitorId();
  clearSessionId();
});

afterEach(() => {
  // Restore originals
  if (originalLocalStorage !== undefined) {
    (globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
  }
  if (originalSessionStorage !== undefined) {
    (globalThis as Record<string, unknown>).sessionStorage = originalSessionStorage;
  }
});

// =============================================================================
// generateId Tests
// =============================================================================

describe('generateId', () => {
  test('generates a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
  });

  test('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  test('ID matches expected format (timestamp_random)', () => {
    const id = generateId();
    const parts = id.split('_');

    // Should have at least 2 parts (timestamp and random)
    expect(parts.length).toBeGreaterThanOrEqual(2);

    // First part should be a valid timestamp
    const timestamp = parseInt(parts[0], 10);
    expect(Number.isNaN(timestamp)).toBe(false);
    expect(timestamp).toBeGreaterThan(0);

    // Timestamp should be recent (within last minute)
    const now = Date.now();
    expect(timestamp).toBeLessThanOrEqual(now);
    expect(timestamp).toBeGreaterThan(now - 60000);
  });

  test('ID has reasonable length', () => {
    const id = generateId();
    // Timestamp (13 chars) + underscore (1) + random (8-36 chars)
    expect(id.length).toBeGreaterThan(14);
    expect(id.length).toBeLessThan(60);
  });
});

// =============================================================================
// getVisitorId Tests
// =============================================================================

describe('getVisitorId', () => {
  test('creates new ID if not exists', () => {
    const id = getVisitorId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('returns same ID on subsequent calls', () => {
    const id1 = getVisitorId();
    const id2 = getVisitorId();
    const id3 = getVisitorId();

    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  test('persists ID in localStorage', () => {
    const id = getVisitorId();
    const storedId = mockLocalStorage.getItem(STORAGE_KEYS.VISITOR_ID);

    expect(storedId).toBe(id);
  });

  test('retrieves existing ID from localStorage', () => {
    // Pre-set an ID in storage
    const existingId = 'existing_visitor_123';
    mockLocalStorage.setItem(STORAGE_KEYS.VISITOR_ID, existingId);

    // Get visitor ID - should retrieve from storage
    // (beforeEach already cleared caches, so this will read from storage)
    const id = getVisitorId();
    expect(id).toBe(existingId);
  });

  test('clearVisitorId removes the ID', () => {
    const id1 = getVisitorId();
    clearVisitorId();

    // Should generate a new ID
    const id2 = getVisitorId();
    expect(id2).not.toBe(id1);
  });
});

// =============================================================================
// getSessionId Tests
// =============================================================================

describe('getSessionId', () => {
  test('creates new ID if not exists', () => {
    const id = getSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('returns same ID on subsequent calls', () => {
    const id1 = getSessionId();
    const id2 = getSessionId();
    const id3 = getSessionId();

    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  test('uses sessionStorage (not localStorage)', () => {
    const id = getSessionId();

    // Should be in sessionStorage
    const sessionStored = mockSessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
    expect(sessionStored).toBe(id);

    // Should NOT be in localStorage
    const localStored = mockLocalStorage.getItem(STORAGE_KEYS.SESSION_ID);
    expect(localStored).toBeNull();
  });

  test('retrieves existing ID from sessionStorage', () => {
    // Pre-set an ID in storage
    const existingId = 'existing_session_456';
    mockSessionStorage.setItem(STORAGE_KEYS.SESSION_ID, existingId);

    // Get session ID - should retrieve from storage
    // (beforeEach already cleared caches, so this will read from storage)
    const id = getSessionId();
    expect(id).toBe(existingId);
  });

  test('clearSessionId removes the ID', () => {
    const id1 = getSessionId();
    clearSessionId();

    // Should generate a new ID
    const id2 = getSessionId();
    expect(id2).not.toBe(id1);
  });
});

// =============================================================================
// Storage Unavailable Tests
// =============================================================================

describe('storage unavailable', () => {
  test('getVisitorId works when localStorage disabled', () => {
    mockLocalStorage.disable();
    resetStorageCache();

    // Should not throw
    const id = getVisitorId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('getVisitorId returns same ID when using memory fallback', () => {
    mockLocalStorage.disable();
    mockSessionStorage.disable();
    resetStorageCache();

    const id1 = getVisitorId();
    const id2 = getVisitorId();

    expect(id1).toBe(id2);
  });

  test('getSessionId works when sessionStorage disabled', () => {
    mockSessionStorage.disable();
    resetStorageCache();

    // Should not throw
    const id = getSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('getSessionId returns same ID when using memory fallback', () => {
    mockSessionStorage.disable();
    resetStorageCache();

    const id1 = getSessionId();
    const id2 = getSessionId();

    expect(id1).toBe(id2);
  });

  test('setItem returns false when storage disabled', () => {
    mockLocalStorage.disable();
    resetStorageCache();

    const result = setItem('test_key', 'test_value');
    expect(result).toBe(false);
  });

  test('getItem returns null when storage disabled and no fallback', () => {
    mockLocalStorage.disable();
    resetStorageCache();

    const result = getItem('nonexistent_key');
    expect(result).toBeNull();
  });
});

// =============================================================================
// Quota Exceeded Tests
// =============================================================================

describe('quota exceeded', () => {
  test('setItem falls back gracefully on QuotaExceededError', () => {
    mockLocalStorage.simulateQuotaExceeded();
    resetStorageCache();

    // Should not throw
    const result = setItem('test_key', 'test_value');
    expect(result).toBe(false);
  });

  test('getVisitorId works when quota exceeded', () => {
    mockLocalStorage.simulateQuotaExceeded();
    resetStorageCache();

    // Should not throw
    const id = getVisitorId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('setSessionItem falls back gracefully on QuotaExceededError', () => {
    mockSessionStorage.simulateQuotaExceeded();
    resetStorageCache();

    // Should not throw
    const result = setSessionItem('test_key', 'test_value');
    expect(result).toBe(false);
  });

  test('value is retrievable from memory after quota exceeded', () => {
    mockLocalStorage.simulateQuotaExceeded();
    resetStorageCache();

    setItem('test_key', 'test_value');
    const retrieved = getItem('test_key');

    expect(retrieved).toBe('test_value');
  });
});

// =============================================================================
// isStorageAvailable Tests
// =============================================================================

describe('isStorageAvailable', () => {
  test('returns true for working localStorage', () => {
    resetStorageCache();
    expect(isStorageAvailable('localStorage')).toBe(true);
  });

  test('returns true for working sessionStorage', () => {
    resetStorageCache();
    expect(isStorageAvailable('sessionStorage')).toBe(true);
  });

  test('returns false for disabled localStorage', () => {
    mockLocalStorage.disable();
    resetStorageCache();
    expect(isStorageAvailable('localStorage')).toBe(false);
  });

  test('returns false for disabled sessionStorage', () => {
    mockSessionStorage.disable();
    resetStorageCache();
    expect(isStorageAvailable('sessionStorage')).toBe(false);
  });

  test('caches availability result', () => {
    resetStorageCache();

    // First call checks storage
    const result1 = isStorageAvailable('localStorage');
    expect(result1).toBe(true);

    // Disable storage
    mockLocalStorage.disable();

    // Second call should return cached result (still true)
    const result2 = isStorageAvailable('localStorage');
    expect(result2).toBe(true);

    // Reset cache and check again
    resetStorageCache();
    const result3 = isStorageAvailable('localStorage');
    expect(result3).toBe(false);
  });
});

// =============================================================================
// getItem / setItem Tests
// =============================================================================

describe('getItem / setItem', () => {
  test('setItem stores value in localStorage', () => {
    const result = setItem('test_key', 'test_value');
    expect(result).toBe(true);
    expect(mockLocalStorage.getItem('test_key')).toBe('test_value');
  });

  test('getItem retrieves value from localStorage', () => {
    mockLocalStorage.setItem('test_key', 'test_value');
    const result = getItem('test_key');
    expect(result).toBe('test_value');
  });

  test('getItem returns null for nonexistent key', () => {
    const result = getItem('nonexistent_key');
    expect(result).toBeNull();
  });
});

// =============================================================================
// getSessionItem / setSessionItem Tests
// =============================================================================

describe('getSessionItem / setSessionItem', () => {
  test('setSessionItem stores value in sessionStorage', () => {
    const result = setSessionItem('test_key', 'test_value');
    expect(result).toBe(true);
    expect(mockSessionStorage.getItem('test_key')).toBe('test_value');
  });

  test('getSessionItem retrieves value from sessionStorage', () => {
    mockSessionStorage.setItem('test_key', 'test_value');
    const result = getSessionItem('test_key');
    expect(result).toBe('test_value');
  });

  test('getSessionItem returns null for nonexistent key', () => {
    const result = getSessionItem('nonexistent_key');
    expect(result).toBeNull();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  test('handles empty string values', () => {
    setItem('empty_key', '');
    const result = getItem('empty_key');
    expect(result).toBe('');
  });

  test('handles special characters in keys', () => {
    const specialKey = '_analytics_特殊_🎉';
    setItem(specialKey, 'value');
    const result = getItem(specialKey);
    expect(result).toBe('value');
  });

  test('handles large values', () => {
    const largeValue = 'x'.repeat(10000);
    setItem('large_key', largeValue);
    const result = getItem('large_key');
    expect(result).toBe(largeValue);
  });

  test('visitor and session IDs are different', () => {
    const visitorId = getVisitorId();
    const sessionId = getSessionId();
    expect(visitorId).not.toBe(sessionId);
  });
});
