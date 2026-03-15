# @lightpanda/serverless

Run [Lightpanda](https://github.com/lightpanda-io/browser) headless browser as a serverless function on AWS Lambda, Vercel, and other Node.js serverless platforms. Includes a built-in crawler with BFS/DFS traversal, sitemap discovery, and robots.txt compliance.

Lightpanda is 9x less memory and 11x faster than headless Chrome. It uses a full V8 JavaScript engine, so React/Vue/Angular SPAs render natively. This package bundles the binary compressed with Brotli, decompresses to `/tmp` on cold start, and caches it for warm invocations.

## Install

```bash
npm install @lightpanda/serverless
```

> **Note:** Before publishing, run `npm run prepare-binary` to download and compress the Lightpanda Linux binary into the package.

## Quick Start

### One-shot page fetch

```typescript
import Lightpanda from "@lightpanda/serverless";

// Fetch a page as markdown (JS-rendered, works with React/Vue/SPAs)
const markdown = await Lightpanda.fetch("https://example.com", {
  dump: "markdown",
});

// Fetch as HTML
const html = await Lightpanda.fetch("https://example.com", { dump: "html" });

// Fetch semantic tree (great for LLMs)
const tree = await Lightpanda.fetch("https://example.com", {
  dump: "semantic_tree",
});
```

### Discover sitemaps

```typescript
import { discoverSitemaps } from "@lightpanda/serverless/crawler";

const result = await discoverSitemaps("https://example.com");
console.log(`Found ${result.totalUrls} pages across ${result.sitemaps.length} sitemaps`);
console.log(result.urls); // [{ url, lastmod, priority, source }]
```

### Crawl multiple pages

```typescript
import { crawlBatch } from "@lightpanda/serverless/crawler";

// First batch
let result = await crawlBatch({
  url: "https://example.com",
  source: "all",        // discover via sitemaps + link following
  strategy: "bfs",      // breadth-first
  maxPages: 50,
  concurrency: 3,       // 3 pages in parallel per batch
});

console.log(result.pages);  // [{ url, markdown, links, images, metadata, ... }]

// Continue crawling with cursor until done
while (result.cursor) {
  result = await crawlBatch({ url: "https://example.com" }, result.cursor);
  console.log(`Crawled ${result.stats.totalPagesCrawled} pages total`);
}
```

### Start a CDP server (Puppeteer/Playwright)

```typescript
import Lightpanda from "@lightpanda/serverless";

const { wsEndpoint, kill } = await Lightpanda.serve({ port: 9222 });

import puppeteer from "puppeteer-core";
const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const page = await browser.newPage();
await page.goto("https://example.com");

kill();
```

## API

### `Lightpanda.fetch(url, options?)`

Single-page fetch using Lightpanda's built-in fetch mode. Returns page content as a string.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dump` | `"html" \| "markdown" \| "semantic_tree" \| "semantic_tree_text"` | `"html"` | Output format |
| `timeout` | `number` | `30000` | Timeout in milliseconds |
| `withFrames` | `boolean` | `false` | Include frame content |
| `withBase` | `boolean` | `false` | Include base URL |
| `obeyRobots` | `boolean` | `false` | Respect robots.txt |
| `strip` | `string[]` | `[]` | Strip modes: `"js"`, `"css"`, `"ui"` |
| `insecureTls` | `boolean` | `false` | Disable TLS host verification (Lambda/AL2023 workaround) |
| `userAgentSuffix` | `string` | — | Append to User-Agent header |

### `Lightpanda.executablePath(input?)`

Returns the path to the Lightpanda binary, decompressing from Brotli on first call.

### `Lightpanda.serve(options?)`

Starts a CDP WebSocket server. Returns `{ process, wsEndpoint, host, port, kill }`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `"127.0.0.1"` | Host to bind |
| `port` | `number` | `9222` | Port to listen on |
| `maxConnections` | `number` | `16` | Max simultaneous CDP connections |
| `timeout` | `number` | `30` | Inactivity timeout in seconds |

---

## Crawler

Import from `@lightpanda/serverless/crawler`.

### `crawlBatch(config, cursor?)`

Crawl pages with BFS/DFS traversal. Designed for serverless — uses cursor-based pagination to work within time limits (60s on Vercel Pro).

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | — | **Required.** Starting URL |
| `source` | `"all" \| "sitemaps" \| "links"` | `"all"` | URL discovery method |
| `strategy` | `"bfs" \| "dfs"` | `"bfs"` | Traversal strategy |
| `maxDepth` | `number` | `10` | Max link-follow depth from seed |
| `maxPages` | `number` | `100` | Max pages total across all batches |
| `concurrency` | `number` | `3` | Pages fetched in parallel per batch |
| `timeBudget` | `number` | `55000` | ms budget per invocation (leave margin for response) |
| `render` | `boolean` | `true` | Use Lightpanda JS rendering. `false` = plain HTTP only |
| `obeyRobots` | `boolean` | `true` | Respect robots.txt and Crawl-delay |
| `extractMetadata` | `boolean` | `false` | Fetch `<head>` metadata (OG, Twitter, JSON-LD). Adds a plain HTTP call per page |
| `includeSubdomains` | `boolean` | `false` | Follow links to subdomains |
| `includeExternalLinks` | `boolean` | `false` | Follow links to external domains |
| `includePatterns` | `string[]` | `[]` | Only crawl URLs matching these patterns (`*` and `**` wildcards) |
| `excludePatterns` | `string[]` | `[]` | Skip URLs matching these patterns (takes priority over include) |
| `pageTimeout` | `number` | `15000` | Timeout per page in ms |
| `strip` | `string[]` | `["css"]` | Strip modes passed to Lightpanda |

**Response:**

```typescript
{
  pages: [{
    url: string;
    status: "completed" | "error" | "disallowed" | "skipped";
    status_code: number | null;
    markdown: string;           // JS-rendered content
    metadata: PageMetadata | null; // when extractMetadata: true
    links: PageLink[];          // { url, anchor_text, type, location }
    images: PageImage[];        // { url, alt }
    depth: number;
    fetchTime: number;          // ms
    error?: string;
  }];
  cursor: string | null;        // null = crawl complete
  stats: {
    pagesCrawled: number;       // this batch
    totalPagesCrawled: number;  // all batches
    pagesRemaining: number;
    elapsed: number;
    stopReason: "complete" | "limit" | "time_budget" | "crawl_delay";
  };
}
```

### `discoverSitemaps(domain, options?)`

Discover all sitemaps for a domain and enumerate their URLs. No browser rendering needed — all plain HTTP.

```typescript
const result = await discoverSitemaps("https://example.com", {
  maxSitemaps: 50,  // cap recursion
  maxDepth: 3,      // max sitemap index depth
});

// result: { domain, sitemaps[], totalUrls, urls[], hasMore }
```

### Metadata extraction

When `extractMetadata: true`, each page gets an extra plain HTTP fetch (~50-100ms) to parse `<head>` tags:

```typescript
interface PageMetadata {
  title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  language: string | null;
  author: string | null;
  robots: string | null;
  og: { title, description, image, url, type, site_name } | null;
  twitter: { card, title, description, image, site } | null;
  jsonLd: unknown[] | null;
}
```

### Link categorization

Links extracted from markdown are automatically categorized:

- **type**: `"internal"` (same domain) or `"external"`
- **location**: `"content"` (body) or `"navigational"` (header/footer)

### Robots.txt utilities

```typescript
import {
  fetchRobotsTxt,
  parseRobotsTxt,
  isUrlAllowed,
  getCrawlDelay,
  getSitemapUrls,
} from "@lightpanda/serverless/crawler";

const content = await fetchRobotsTxt("https://example.com");
const rules = parseRobotsTxt(content!, "MyCrawler");
console.log(isUrlAllowed("https://example.com/admin", rules)); // false
console.log(getCrawlDelay(rules)); // 2000 (ms) or null
console.log(getSitemapUrls(rules)); // ["https://example.com/sitemap.xml"]
```

---

## Vercel Deployment

The `examples/vercel/` directory contains a working Vercel app with three endpoints:

```json
{
  "functions": {
    "api/**/*.ts": {
      "memory": 1024,
      "maxDuration": 60,
      "includeFiles": "node_modules/@lightpanda/serverless/bin/**"
    }
  }
}
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fetch?url=...&format=...` | GET | Single page fetch |
| `/api/discover?url=...` | GET | Sitemap discovery + page count |
| `/api/crawl` | POST | Multi-page crawl with cursor pagination |

### Crawl endpoint example

```bash
# Start a crawl
curl -X POST https://your-app.vercel.app/api/crawl \
  -H 'Content-Type: application/json' \
  -d '{"config": {"url": "https://example.com", "maxPages": 10}}'

# Continue with cursor
curl -X POST https://your-app.vercel.app/api/crawl \
  -H 'Content-Type: application/json' \
  -d '{"config": {"url": "https://example.com"}, "cursor": "base64..."}'
```

## AWS Lambda Deployment

```typescript
import Lightpanda from "@lightpanda/serverless";

export const handler = async (event) => {
  const content = await Lightpanda.fetch(event.url, {
    dump: event.format || "markdown",
    insecureTls: true, // Required on Lambda/AL2023
    timeout: 25_000,
  });
  return { statusCode: 200, body: content };
};
```

## Testing

```bash
npm test
```

48 tests covering robots.txt parsing, metadata extraction, link categorization, cursor round-trips, sitemap parsing, and integration tests with real HTTP calls.

CI runs on every push via GitHub Actions (Node 20 + 22).

## Binary Preparation

```bash
npm run prepare-binary              # Download both x64 and arm64
npm run prepare-binary -- --arch x64  # x64 only
LIGHTPANDA_RELEASE=v1.0.0 npm run prepare-binary  # Specific release
```

## Size Budget

| Component | Size |
|-----------|------|
| Lightpanda binary (uncompressed) | ~107 MB |
| Brotli-compressed (.br) | ~26 MB |
| npm package total | ~27 MB |

## How It Works

1. **Build time**: `prepare-binary` downloads the Lightpanda Linux binary and compresses with Brotli (~4x compression)
2. **Cold start**: Decompresses binary to `/tmp/lightpanda` (~3-4s)
3. **Warm start**: Binary already cached in `/tmp`, skip decompression
4. **Fetch**: Spawns binary as child process. Full V8 JS engine renders SPAs natively
5. **Crawl**: BFS/DFS traversal with cursor-based pagination. Up to 3 pages in parallel per invocation. Respects robots.txt and Crawl-delay

## Known Issues

- **TLS on Lambda/AL2023**: Lightpanda's Zig-based cert loader doesn't load CA certs correctly on Amazon Linux 2023. Use `insecureTls: true` as a workaround

## License

AGPL-3.0 — Same as [Lightpanda](https://github.com/lightpanda-io/browser)
