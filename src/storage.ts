/**
 * @youranalytics/web-sdk Storage Utilities
 * Safe browser storage with fallbacks for edge cases
 */

import { createVisitorId, createSessionId, type VisitorId, type SessionId } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Storage key for visitor ID */
const VISITOR_ID_KEY = '_analytics_vid';

/** Storage key for session ID */
const SESSION_ID_KEY = '_analytics_sid';

/** Test key used to verify storage availability */
const STORAGE_TEST_KEY = '_analytics_test';

// =============================================================================
// Storage Access Helpers
// =============================================================================

/**
 * Get storage object, working in both browser and test environments.
 * Tries window first (browser), then globalThis (Bun/Node tests).
 */
function getStorage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    // Try window first (standard browser environment)
    if (typeof window !== 'undefined' && window[type]) {
      return window[type];
    }
    // Fall back to globalThis (for test environments like Bun)
    if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)[type]) {
      return (globalThis as Record<string, unknown>)[type] as Storage;
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// In-Memory Fallback Storage
// =============================================================================

/** Fallback storage when localStorage/sessionStorage unavailable */
const memoryStorage = new Map<string, string>();

function getFromMemory(key: string): string | null {
  return memoryStorage.get(key) ?? null;
}

function setInMemory(key: string, value: string): void {
  memoryStorage.set(key, value);
}

// =============================================================================
// Storage Availability Cache
// =============================================================================

type StorageType = 'localStorage' | 'sessionStorage';

/** Cache storage availability to avoid repeated checks */
const storageAvailabilityCache: Record<StorageType, boolean | null> = {
  localStorage: null,
  sessionStorage: null,
};

/**
 * Test if a storage type is available and working.
 * Result is cached after first check.
 *
 * @param type - The storage type to check
 * @returns true if storage is available and functional
 */
export function isStorageAvailable(type: StorageType): boolean {
  // Return cached result if available
  if (storageAvailabilityCache[type] !== null) {
    return storageAvailabilityCache[type];
  }

  try {
    const storage = getStorage(type);

    // Storage might exist but be null in some browsers
    if (!storage) {
      storageAvailabilityCache[type] = false;
      return false;
    }

    // Test actual read/write capability
    storage.setItem(STORAGE_TEST_KEY, 'test');
    storage.removeItem(STORAGE_TEST_KEY);

    storageAvailabilityCache[type] = true;
    return true;
  } catch {
    // SecurityError, QuotaExceededError, or other errors
    storageAvailabilityCache[type] = false;
    return false;
  }
}

/**
 * Reset storage availability cache.
 * Useful for testing or when storage state might have changed.
 */
export function resetStorageCache(): void {
  storageAvailabilityCache.localStorage = null;
  storageAvailabilityCache.sessionStorage = null;
  memoryStorage.clear();
}

// =============================================================================
// Safe Storage Access
// =============================================================================

/**
 * Safely get item from localStorage.
 *
 * @param key - Storage key
 * @returns Value or null if not found/error
 */
export function getItem(key: string): string | null {
  // Try localStorage first
  if (isStorageAvailable('localStorage')) {
    try {
      const storage = getStorage('localStorage');
      return storage?.getItem(key) ?? null;
    } catch {
      // Fall through to memory storage
    }
  }

  // Fall back to memory storage
  return getFromMemory(key);
}

/**
 * Safely set item in localStorage.
 *
 * @param key - Storage key
 * @param value - Value to store
 * @returns true if successful, false if failed
 */
export function setItem(key: string, value: string): boolean {
  // Try localStorage first
  if (isStorageAvailable('localStorage')) {
    try {
      const storage = getStorage('localStorage');
      storage?.setItem(key, value);
      return true;
    } catch {
      // QuotaExceededError or other errors - fall through
    }
  }

  // Fall back to memory storage
  setInMemory(key, value);
  return false;
}

/**
 * Safely get item from sessionStorage.
 *
 * @param key - Storage key
 * @returns Value or null if not found/error
 */
export function getSessionItem(key: string): string | null {
  // Try sessionStorage first
  if (isStorageAvailable('sessionStorage')) {
    try {
      const storage = getStorage('sessionStorage');
      return storage?.getItem(key) ?? null;
    } catch {
      // Fall through to memory storage
    }
  }

  // Fall back to memory storage
  return getFromMemory(key);
}

/**
 * Safely set item in sessionStorage.
 *
 * @param key - Storage key
 * @param value - Value to store
 * @returns true if successful, false if failed
 */
export function setSessionItem(key: string, value: string): boolean {
  // Try sessionStorage first
  if (isStorageAvailable('sessionStorage')) {
    try {
      const storage = getStorage('sessionStorage');
      storage?.setItem(key, value);
      return true;
    } catch {
      // QuotaExceededError or other errors - fall through
    }
  }

  // Fall back to memory storage
  setInMemory(key, value);
  return false;
}

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique ID using crypto.randomUUID or fallback.
 * Format: timestamp_randomString
 * Example: "1704067200000_x7k9m2p" or "1704067200000_a1b2c3d4-e5f6-..."
 *
 * @returns Unique identifier string
 */
export function generateId(): string {
  const timestamp = Date.now();

  // Try crypto.randomUUID first (modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return `${timestamp}_${crypto.randomUUID()}`;
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: generate random string using Math.random
  const randomPart = generateRandomString(8);
  return `${timestamp}_${randomPart}`;
}

/**
 * Generate a random alphanumeric string.
 *
 * @param length - Desired string length
 * @returns Random string
 */
function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  // Try crypto.getRandomValues for better randomness
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      const array = new Uint8Array(length);
      crypto.getRandomValues(array);
      for (let i = 0; i < length; i++) {
        result += chars[array[i] % chars.length];
      }
      return result;
    } catch {
      // Fall through to Math.random
    }
  }

  // Fallback to Math.random
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// =============================================================================
// ID Cache & Retrieval
// =============================================================================

let cachedVisitorId: VisitorId | null = null;
let cachedSessionId: SessionId | null = null;

export function getVisitorId(): VisitorId {
  if (cachedVisitorId) return cachedVisitorId;

  // Try localStorage → sessionStorage → memory
  let id = getItem(VISITOR_ID_KEY);
  if (!id && isStorageAvailable('sessionStorage')) {
    try { id = getStorage('sessionStorage')?.getItem(VISITOR_ID_KEY) ?? null; } catch { /* ignore */ }
  }
  if (!id) id = getFromMemory(VISITOR_ID_KEY);

  if (!id) {
    id = generateId();
    setItem(VISITOR_ID_KEY, id);
    try { getStorage('sessionStorage')?.setItem(VISITOR_ID_KEY, id); } catch { /* ignore */ }
  }

  cachedVisitorId = createVisitorId(id);
  return cachedVisitorId;
}

export function getSessionId(): SessionId {
  if (cachedSessionId) return cachedSessionId;

  let id = getSessionItem(SESSION_ID_KEY) ?? getFromMemory(SESSION_ID_KEY);
  if (!id) {
    id = generateId();
    setSessionItem(SESSION_ID_KEY, id);
  }

  cachedSessionId = createSessionId(id);
  return cachedSessionId;
}

export function clearVisitorId(): void {
  cachedVisitorId = null;
  try { getStorage('localStorage')?.removeItem(VISITOR_ID_KEY); } catch { /* ignore */ }
  try { getStorage('sessionStorage')?.removeItem(VISITOR_ID_KEY); } catch { /* ignore */ }
  memoryStorage.delete(VISITOR_ID_KEY);
}

export function clearSessionId(): void {
  cachedSessionId = null;
  try { getStorage('sessionStorage')?.removeItem(SESSION_ID_KEY); } catch { /* ignore */ }
  memoryStorage.delete(SESSION_ID_KEY);
}

// =============================================================================
// Exports for Testing
// =============================================================================

/** Storage keys exported for testing */
export const STORAGE_KEYS = {
  VISITOR_ID: VISITOR_ID_KEY,
  SESSION_ID: SESSION_ID_KEY,
} as const;
