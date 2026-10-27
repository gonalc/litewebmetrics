# litewebmetrics

Lightweight analytics tracker for web applications. Under 3KB gzipped with support for older browsers and optimized for slow networks.

## Features

- **Tiny footprint** - Core bundle <3KB gzipped
- **Auto pageview tracking** - Tracks pageviews on load
- **Custom events** - Track any event with properties
- **Offline support** - Events queued and sent when online
- **sendBeacon** - Reliable delivery on page unload
- **Bot filtering** - Automatically ignores known bots

## Quick Start

### Script Tag

```html
<script
  src="https://sdk.litewebmetrics.com/v0.0.1/analytics.min.js"
  data-api-key="your_api_key"
></script>
```

### Track Events

```javascript
// Custom events
analytics.track('signup', { plan: 'pro' });
analytics.track('purchase', { product_id: 'abc', price: 99 });
```

## Installation

### Option 1: Script Tag (recommended)

```html
<script
  src="/path/to/analytics.min.js"
  data-api-key="pk_test_abc123"
  data-endpoint="https://your-analytics-server.example.com"
></script>
```

For local development:

```html
<script
  src="/path/to/analytics.min.js"
  data-api-key="pk_test_abc123"
  data-endpoint="http://localhost:8080"
  data-debug="true"
></script>
```

### Option 2: ES Module

```javascript
import analytics from 'litewebmetrics';

analytics.init('pk_test_abc123', {
  endpoint: 'https://your-analytics-server.example.com'
});
```

## Configuration

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-api-key` | required | Your project API key |
| `data-endpoint` | required | Your analytics server URL |
| `data-debug` | `false` | Enable console logging |
| `data-auto-track` | `true` | Auto-track pageviews |

### JavaScript options

| Option | Default | Description |
|--------|---------|-------------|
| `endpoint` | hosted service | Your analytics server URL |
| `debug` | `false` | Enable console logging |
| `autoTrack` | `true` | Auto-track pageviews (initial + SPA navigation) |
| `maxQueueSize` | `10` | Events queued before an automatic flush |
| `flushInterval` | `5000` | Flush interval in ms |
| `sanitizeUrl` | - | `(url) => string`, rewrites the page URL before it is stored on an event (e.g. replace ids/tokens with route patterns, drop query/hash). Falls back to the raw URL if it throws or returns a non-string |
| `visitorId` | generated | Use your own persisted visitor ID instead of the generated one. Not written to storage |

```javascript
analytics.init(key, { autoTrack: false, sanitizeUrl: (u) => new URL(u).pathname });
```

`sanitizeUrl` must be pure and synchronous: its result is cached per URL, so it runs once for each distinct URL. It only rewrites `page_url`; `referrer` and UTM parameters are not changed.

`page_url` and `page_title` are captured when `track()` is called, so events keep the page they were tracked on even if they are flushed later.

## API

```javascript
// Initialize
analytics.init(apiKey, { endpoint, debug, autoTrack, sanitizeUrl, visitorId });

// Track event
analytics.track('event_name', { key: 'value' });

// Force send queued events
await analytics.flush();

// Get visitor/session IDs
analytics.instance.getVisitorId();
analytics.instance.getSessionId();
```

## Documentation

See the complete **[SDK Usage Guide](https://litewebmetrics.com/docs/)** for:
- Framework integration (Astro, React, Vue, Next.js)
- SPA route tracking
- Event tracking examples
- Troubleshooting

## Development

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later

### Setup

```bash
bun install
```

### Build

```bash
# Build all formats
bun run build

# Development mode (watch)
bun run dev
```

### Build Output

| File | Size | Description |
|------|------|-------------|
| `dist/analytics.min.js` | ~1.6KB gzip | Core build (recommended) |
| `dist/analytics.esm.js` | ~10KB gzip | ES Module |
| `dist/analytics.js` | ~10KB gzip | IIFE unminified |
| `dist/analytics.full.min.js` | ~8KB gzip | Full features |

### Testing

```bash
bun test
bun test:watch
```

### Size Check

```bash
bun run size-check
```

Target: Core bundle <3KB gzipped

## License

MIT
