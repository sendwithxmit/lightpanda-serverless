import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { arch } from "node:process";
import { join, dirname } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

// Resolve __dirname for both ESM and CJS builds
const _getDirname = (): string => {
  // CJS: __dirname is available globally
  if (typeof __dirname !== "undefined") return __dirname;
  // ESM: derive from import.meta.url
  // @ts-ignore - import.meta.url is only available in ESM
  return dirname(new URL(import.meta.url).pathname);
};
const _currentDir = _getDirname();

import { inflate } from "./inflate.js";

function getBinDir(base: string): string {
  const archDir = arch === "arm64" ? "arm64" : "x64";
  return join(base, "bin", archDir);
}

const execFile = promisify(execFileCb);

export type DumpFormat = "html" | "markdown" | "semantic_tree" | "semantic_tree_text";

export interface FetchOptions {
  /** Output format. Default: "html" */
  dump?: DumpFormat;
  /** Include frames in output */
  withFrames?: boolean;
  /** Include base URL in output */
  withBase?: boolean;
  /** Timeout in milliseconds for the page load. Default: 30000 */
  timeout?: number;
  /** Obey robots.txt */
  obeyRobots?: boolean;
  /** Strip JS and/or CSS from output. e.g. ["js", "css"] */
  strip?: string[];
  /** Disable TLS host verification (workaround for Lambda/AL2023 cert issues) */
  insecureTls?: boolean;
  /** Custom user agent suffix */
  userAgentSuffix?: string;
}

export interface ServeOptions {
  /** Host to bind to. Default: "127.0.0.1" */
  host?: string;
  /** Port to listen on. Default: 9222 */
  port?: number;
  /** Max simultaneous CDP connections. Default: 16 */
  maxConnections?: number;
  /** Inactivity timeout in seconds. Default: 30 */
  timeout?: number;
}

class Lightpanda {
  /**
   * Returns the path to the Lightpanda binary, decompressing it to /tmp if needed.
   * On warm Lambda invocations, returns the cached path immediately.
   */
  /**
   * Override the package root directory. Useful when the package is installed
   * in a non-standard location (e.g. Lambda layers).
   */
  static packageDir: string | undefined;

  static async executablePath(input?: string): Promise<string> {
    const cached = join(tmpdir(), "lightpanda");
    if (existsSync(cached)) {
      return cached;
    }

    let binDir: string;
    if (input) {
      binDir = input;
    } else {
      // Resolve package root: two levels up from build/esm/ or build/cjs/
      const pkgRoot = this.packageDir ?? join(_currentDir, "..", "..");
      binDir = getBinDir(pkgRoot);
    }
    const compressedPath = join(binDir, "lightpanda.br");

    if (!existsSync(compressedPath)) {
      throw new Error(
        `Compressed binary not found at "${compressedPath}". ` +
        `Run "npm run prepare-binary" to download and compress the Lightpanda binary.`
      );
    }

    return inflate(compressedPath);
  }

  /**
   * Fetches a URL and returns the page content.
   * Uses Lightpanda's built-in "fetch" mode — a single-shot page load.
   */
  static async fetch(url: string, options: FetchOptions = {}): Promise<string> {
    const binary = await this.executablePath();
    const args = ["fetch", url];

    const dump = options.dump ?? "html";
    args.push("--dump", dump);

    if (options.withFrames) {
      args.push("--with_frames");
    }

    if (options.withBase) {
      args.push("--with_base");
    }

    if (options.timeout !== undefined) {
      args.push("--http_timeout", String(options.timeout));
    }

    if (options.obeyRobots) {
      args.push("--obey_robots");
    }

    if (options.strip && options.strip.length > 0) {
      args.push("--strip_mode", options.strip.join(","));
    }

    if (options.insecureTls) {
      args.push("--insecure_disable_tls_host_verification");
    }

    if (options.userAgentSuffix) {
      args.push("--user_agent_suffix", options.userAgentSuffix);
    }

    const { stdout } = await execFile(binary, args, {
      maxBuffer: 100 * 1024 * 1024, // 100MB
      timeout: options.timeout ?? 30_000,
    });

    return stdout;
  }

  /**
   * Starts a CDP server and returns connection details.
   * Useful when you need Puppeteer/Playwright compatibility.
   * The caller is responsible for killing the returned process.
   */
  static async serve(options: ServeOptions = {}) {
    const binary = await this.executablePath();
    const { spawn } = await import("node:child_process");

    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 9222;

    const args = [
      "serve",
      "--host", host,
      "--port", String(port),
    ];

    if (options.maxConnections !== undefined) {
      args.push("--cdp_max_connections", String(options.maxConnections));
    }

    if (options.timeout !== undefined) {
      args.push("--timeout", String(options.timeout));
    }

    const process = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for the server to be ready by watching stderr for the listening message
    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Lightpanda CDP server failed to start within 10s"));
      }, 10_000);

      let stderrBuffer = "";

      process.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        // Lightpanda logs the WebSocket URL when ready
        const match = stderrBuffer.match(/ws:\/\/[^\s]+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });

      process.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      process.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Lightpanda exited with code ${code ?? "unknown"}: ${stderrBuffer}`));
      });
    });

    return {
      process,
      wsEndpoint,
      host,
      port,
      kill: () => process.kill(),
    };
  }
}

export default Lightpanda;

export * from "./crawler/index.js";
