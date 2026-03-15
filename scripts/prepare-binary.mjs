#!/usr/bin/env node

/**
 * Downloads the Lightpanda nightly binary from GitHub releases
 * and compresses it with brotli for serverless deployment.
 *
 * Usage:
 *   node scripts/prepare-binary.mjs              # downloads both x64 and arm64
 *   node scripts/prepare-binary.mjs --arch x64   # downloads only x64
 *   node scripts/prepare-binary.mjs --arch arm64  # downloads only arm64
 */

import { createWriteStream, createReadStream, mkdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, constants } from "node:zlib";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, "..", "bin");

const RELEASE_TAG = process.env.LIGHTPANDA_RELEASE ?? "nightly";
const BASE_URL = `https://github.com/lightpanda-io/browser/releases/download/${RELEASE_TAG}`;

const BINARIES = {
  x64: {
    url: `${BASE_URL}/lightpanda-x86_64-linux`,
    dir: join(binDir, "x64"),
  },
  arm64: {
    url: `${BASE_URL}/lightpanda-aarch64-linux`,
    dir: join(binDir, "arm64"),
  },
};

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const request = (url) => {
      https.get(url, (response) => {
        // Follow redirects (GitHub releases redirect to S3)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers["content-length"] ?? "0", 10);
        let downloadedBytes = 0;

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r  Downloading... ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)`);
          }
        });

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log();
          resolve();
        });
      }).on("error", reject);
    };
    request(url);
  });
}

async function compressWithBrotli(inputPath, outputPath) {
  const source = createReadStream(inputPath);
  const destination = createWriteStream(outputPath);
  const brotli = createBrotliCompress({
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: 0,
    },
  });

  console.log("  Compressing with brotli (this may take a minute)...");
  await pipeline(source, brotli, destination);
}

async function prepareBinary(archKey) {
  const config = BINARIES[archKey];
  const rawPath = join(config.dir, "lightpanda");
  const compressedPath = join(config.dir, "lightpanda.br");

  console.log(`\n[${archKey}] Preparing Lightpanda binary...`);

  if (existsSync(compressedPath)) {
    const stats = statSync(compressedPath);
    console.log(`  Already exists: ${compressedPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB) — skipping`);
    return;
  }

  mkdirSync(config.dir, { recursive: true });

  console.log(`  Source: ${config.url}`);
  await download(config.url, rawPath);

  await compressWithBrotli(rawPath, compressedPath);

  // Remove the raw binary, keep only the compressed one
  unlinkSync(rawPath);

  const stats = statSync(compressedPath);
  console.log(`  Output: ${compressedPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
}

// Parse args
const args = process.argv.slice(2);
const archIdx = args.indexOf("--arch");
const targetArch = archIdx !== -1 ? args[archIdx + 1] : null;

if (targetArch && !BINARIES[targetArch]) {
  console.error(`Unknown architecture: ${targetArch}. Use "x64" or "arm64".`);
  process.exit(1);
}

const architectures = targetArch ? [targetArch] : Object.keys(BINARIES);

console.log(`Preparing Lightpanda binaries for: ${architectures.join(", ")}`);
console.log(`Release: ${RELEASE_TAG}`);

for (const arch of architectures) {
  await prepareBinary(arch);
}

console.log("\nDone! Binaries are ready for publishing.");
