/**
 * @youranalytics/web-sdk - Core Build
 * Ultra-minimal analytics SDK (<3KB gzipped)
 * Basic tracking without adaptive networking
 */

// Injected at build time from ANALYTICS_ENDPOINT env var
declare const ANALYTICS_ENDPOINT: string;

// =============================================================================
// Types
// =============================================================================

interface Config {
  apiKey: string;
  endpoint: string;
  debug: boolean;
  autoTrack: boolean;
  maxQueueSize: number;
  flushInterval: number;
  sanitizeUrl?: (url: string) => string;
}

type Opts = Partial<Config> & { visitorId?: string };
type QE = { e: string; p: Record<string, unknown>; t: number; u: string; ti: string };

interface Event {
  event: string;
  properties: Record<string, unknown>;
  timestamp: number;
  visitor_id: string;
  session_id: string;
  page_url: string;
  page_title?: string;
  referrer?: string;
  user_agent: string;
  screen_width: number;
  screen_height: number;
}

// =============================================================================
// Utilities
// =============================================================================

const VISITOR_KEY = '_a_vid';
const SESSION_KEY = '_a_sid';

function genId(): string {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function getStorage(key: string, session = false): string | null {
  try {
    const s = session ? sessionStorage : localStorage;
    return s.getItem(key);
  } catch { return null; }
}

function setStorage(key: string, val: string, session = false): void {
  try {
    const s = session ? sessionStorage : localStorage;
    s.setItem(key, val);
  } catch { /* ignore */ }
}

function getVisitorId(): string {
  let id = getStorage(VISITOR_KEY);
  if (!id) {
    id = genId();
    setStorage(VISITOR_KEY, id);
  }
  return id;
}

function getSessionId(): string {
  let id = getStorage(SESSION_KEY, true);
  if (!id) {
    id = genId();
    setStorage(SESSION_KEY, id, true);
  }
  return id;
}

function isBot(): boolean {
  const ua = navigator.userAgent?.toLowerCase() || '';
  return /bot|crawler|spider|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|headless|phantom|selenium|puppeteer/.test(ua);
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 100) || 'event';
}

// =============================================================================
// Core Analytics
// =============================================================================

class Core {
  private cfg: Config;
  private q: QE[] = [];
  private vid: string;
  private sid: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ok = false;
  private lu: string | null = null; // last raw URL seen by sanitizeUrl
  private ls = ''; // its sanitized result

  constructor(config: Opts & { apiKey: string }) {
    if (!config.apiKey) throw new Error('API key required');

    this.cfg = {
      apiKey: config.apiKey,
      endpoint: config.endpoint ?? ANALYTICS_ENDPOINT,
      debug: config.debug || false,
      autoTrack: config.autoTrack !== false,
      maxQueueSize: config.maxQueueSize || 10,
      flushInterval: config.flushInterval || 5000,
      sanitizeUrl: config.sanitizeUrl,
    };

    // Explicit visitorId wins and is not written to storage
    const v = config.visitorId;
    this.vid = typeof v == 'string' && v ? v : getVisitorId();
    this.sid = getSessionId();

    if (isBot()) return;

    this.ok = true;
    if (this.cfg.autoTrack) this.trackPV();
    this.startTimer();

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
  }

  track(event: string, props: Record<string, unknown> = {}): void {
    if (!this.ok) return;
    // Capture page context now, not at flush time
    this.q.push({ e: sanitize(event), p: props, t: Date.now(), u: this.url(), ti: document.title });
    if (this.q.length >= this.cfg.maxQueueSize) this.flush();
  }

  trackPV(): void {
    this.track('pageview');
  }

  async flush(): Promise<void> {
    if (!this.q.length) return;
    const events = this.q;
    this.q = [];
    await this.send(events);
  }

  // Current URL through sanitizeUrl, cached per raw URL; raw URL if it throws/returns non-string
  private url(): string {
    const u = location.href, f = this.cfg.sanitizeUrl;
    if (!f) return u;
    if (u !== this.lu) {
      let s: unknown = u;
      try { s = f(u); } catch { /* use raw */ }
      this.lu = u;
      this.ls = typeof s == 'string' ? s : u;
    }
    return this.ls;
  }

  private async send(events: QE[]): Promise<void> {
    if (!events.length) return;

    const batch = {
      api_key: this.cfg.apiKey,
      events: events.map(e => this.build(e)),
    };

    const url = this.cfg.endpoint + '/events';

    try {
      // Try sendBeacon first (can't send custom headers, but server accepts api_key in body)
      if (navigator.sendBeacon?.(url, new Blob([JSON.stringify(batch)], { type: 'application/json' }))) return;
      // Fall back to fetch with Authorization header
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(batch),
        keepalive: true,
        credentials: 'omit', // Never send cookies
      });
    } catch (e) {
      if (this.cfg.debug) console.error('[Analytics]', e);
    }
  }

  private build(e: QE): Event {
    return {
      event: e.e,
      properties: e.p,
      timestamp: e.t,
      visitor_id: this.vid,
      session_id: this.sid,
      page_url: e.u,
      page_title: e.ti,
      referrer: document.referrer,
      user_agent: navigator.userAgent,
      screen_width: screen.width,
      screen_height: screen.height,
    };
  }

  private startTimer(): void {
    if (this.cfg.flushInterval > 0) {
      this.timer = setInterval(() => this.flush(), this.cfg.flushInterval);
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
    this.ok = false;
  }

  getVisitorId(): string { return this.vid; }
  getSessionId(): string { return this.sid; }
}

// =============================================================================
// Global API
// =============================================================================

import { VERSION } from './version';

interface GA {
  version: string;
  instance: Core | null;
  init(apiKey: string, cfg?: Omit<Opts, 'apiKey'>): Core;
  track(e: string, p?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

const ga: GA = {
  version: VERSION,
  instance: null,
  init(apiKey, cfg = {}) {
    if (this.instance) this.instance.destroy();
    this.instance = new Core({ apiKey, ...cfg });
    return this.instance;
  },
  track(e, p = {}) {
    if (!this.instance) { console.warn('[Analytics] Not initialized'); return; }
    this.instance.track(e, p);
  },
  async flush() { if (this.instance) await this.instance.flush(); },
};

// Auto-init
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).analytics = ga;
  const s = document.currentScript as HTMLScriptElement | null;
  const k = s?.getAttribute('data-api-key');
  if (k) ga.init(k, {
    endpoint: s?.getAttribute('data-endpoint') ?? undefined,
    debug: s?.getAttribute('data-debug') === 'true',
  });
}

export { Core as Analytics, VERSION };
export default ga;
