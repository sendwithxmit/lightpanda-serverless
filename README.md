# @lightpanda/serverless

Run [Lightpanda](https://github.com/lightpanda-io/browser) headless browser as a serverless function on AWS Lambda, Vercel, and other Node.js serverless platforms.

Lightpanda is 9x less memory and 11x faster than headless Chrome. This package bundles the Lightpanda binary compressed with Brotli, decompresses it to `/tmp` on cold start, and caches it for warm invocations.

## Install

```bash
npm install @lightpanda/serverless
```

> **Note:** Before publishing, run `npm run prepare-binary` to download and compress the Lightpanda Linux binary into the package.

## Quick Start

### One-shot page fetch

```typescript
import Lightpanda from "@lightpanda/serverless";

// Fetch a page as markdown
const markdown = await Lightpanda.fetch("https://example.com", {
  dump: "markdown",
});

// Fetch as HTML
const html = await Lightpanda.fetch("https://example.com", {
  dump: "html",
});

// Fetch semantic tree (great for LLMs)
const tree = await Lightpanda.fetch("https://example.com", {
  dump: "semantic_tree",
});
```

### Get the binary path (for custom usage)

```typescript
import Lightpanda from "@lightpanda/serverless";

const binaryPath = await Lightpanda.executablePath();
// Use with child_process, or connect via CDP
```

### Start a CDP server (Puppeteer/Playwright)

```typescript
import Lightpanda from "@lightpanda/serverless";

const { wsEndpoint, kill } = await Lightpanda.serve({ port: 9222 });

// Connect with Puppeteer
import puppeteer from "puppeteer-core";
const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const page = await browser.newPage();
await page.goto("https://example.com");

// Don't forget to clean up
kill();
```

## API

### `Lightpanda.fetch(url, options?)`

Fetches a URL using Lightpanda's built-in fetch mode. Returns the page content as a string.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dump` | `"html" \| "markdown" \| "semantic_tree" \| "semantic_tree_text"` | `"html"` | Output format |
| `timeout` | `number` | `30000` | Timeout in milliseconds |
| `withFrames` | `boolean` | `false` | Include frame content |
| `withBase` | `boolean` | `false` | Include base URL |
| `obeyRobots` | `boolean` | `false` | Respect robots.txt |
| `strip` | `string[]` | `[]` | Strip modes: `"js"`, `"css"`, `"ui"` |
| `userAgentSuffix` | `string` | — | Append to User-Agent header |

### `Lightpanda.executablePath(input?)`

Returns the path to the Lightpanda binary, decompressing from Brotli on first call. On warm Lambda invocations, returns the cached path immediately.

### `Lightpanda.serve(options?)`

Starts a CDP WebSocket server. Returns `{ process, wsEndpoint, host, port, kill }`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `"127.0.0.1"` | Host to bind |
| `port` | `number` | `9222` | Port to listen on |
| `maxConnections` | `number` | `16` | Max simultaneous CDP connections |
| `timeout` | `number` | `30` | Inactivity timeout in seconds |

### `Lightpanda.packageDir`

Static property to override the package root directory. Useful when the package is installed in a non-standard location (e.g., Lambda layers).

## Output Formats

### `markdown`

Converts the full DOM to GitHub-flavored markdown. Automatically skips `<script>`, `<style>`, and metadata tags. Resolves all URLs to absolute. Supports tables, nested lists, code blocks, and inline formatting.

### `html`

Returns the serialized DOM HTML after JavaScript execution.

### `semantic_tree`

Returns a JSON accessibility tree with ARIA roles, names, XPath positions, and interactivity flags. Great for LLM consumption — use with `strip: ["js", "css"]` to reduce token count.

### `semantic_tree_text`

Plain text version of the semantic tree with indented structure.

## Vercel Deployment

```bash
# 1. In your Vercel project, install the package
npm install @lightpanda/serverless

# 2. Add includeFiles to vercel.json so the binary gets bundled
```

```json
{
  "functions": {
    "api/**/*.ts": {
      "memory": 1024,
      "maxDuration": 30,
      "includeFiles": "node_modules/@lightpanda/serverless/bin/**"
    }
  }
}
```

```typescript
// api/fetch.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Lightpanda from "@lightpanda/serverless";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = req.query["url"] as string;
  const content = await Lightpanda.fetch(url, { dump: "markdown" });
  res.status(200).send(content);
}
```

## AWS Lambda Deployment

Package the binary as a Lambda layer or include it in your deployment bundle:

```typescript
import Lightpanda from "@lightpanda/serverless";

export const handler = async (event) => {
  const content = await Lightpanda.fetch(event.url, {
    dump: event.format || "markdown",
    timeout: 25_000,
  });
  return { statusCode: 200, body: content };
};
```

## Binary Preparation

The `prepare-binary` script downloads the Lightpanda nightly release and compresses it with Brotli:

```bash
# Download both x64 and arm64
npm run prepare-binary

# Download only x64
npm run prepare-binary -- --arch x64

# Download only arm64
npm run prepare-binary -- --arch arm64

# Use a specific release tag
LIGHTPANDA_RELEASE=v1.0.0 npm run prepare-binary
```

## Size Budget

| Component | Size |
|-----------|------|
| Lightpanda binary (uncompressed) | ~107 MB |
| Brotli-compressed (.br) | ~26 MB |
| npm package total | ~27 MB |
| Vercel function size | ~26 MB |
| Lambda unzipped limit | 250 MB |

## Known Issues

- **TLS on Lambda/AL2023**: Lightpanda's Zig-based certificate loader (`std.crypto.Certificate.Bundle.rescan()`) doesn't correctly load CA certificates on Amazon Linux 2023. Workaround: pass `--insecure_disable_tls_host_verification` flag. This needs an upstream fix in Lightpanda's `src/network/Runtime.zig`.

## How It Works

1. **Build time**: `prepare-binary` downloads the Lightpanda Linux binary from GitHub releases and compresses it with Brotli (quality 6, ~4x compression)
2. **npm publish**: The compressed binary ships inside the npm package under `bin/`
3. **Cold start**: On first invocation, decompresses the binary to `/tmp/lightpanda` (~3-4 seconds)
4. **Warm start**: Subsequent invocations find `/tmp/lightpanda` already cached and skip decompression
5. **Execution**: Spawns the binary as a child process with the requested command

## License

AGPL-3.0 — Same as [Lightpanda](https://github.com/lightpanda-io/browser)
