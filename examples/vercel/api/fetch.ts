import type { VercelRequest, VercelResponse } from "@vercel/node";
import { existsSync, createReadStream, createWriteStream, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrotliDecompress } from "node:zlib";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const BINARY_PATH = join(tmpdir(), "lightpanda");

async function getExecutablePath(): Promise<string> {
  if (existsSync(BINARY_PATH)) return BINARY_PATH;

  const brPath = join(process.cwd(), "node_modules", "@lightpanda", "serverless", "bin", "x64", "lightpanda.br");
  if (!existsSync(brPath)) {
    throw new Error(`Compressed binary not found at ${brPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const source = createReadStream(brPath);
    const decomp = createBrotliDecompress();
    const target = createWriteStream(BINARY_PATH, { mode: 0o755 });
    target.once("close", () => resolve());
    source.once("error", reject);
    decomp.once("error", reject);
    target.once("error", reject);
    source.pipe(decomp).pipe(target);
  });
  chmodSync(BINARY_PATH, 0o755);
  return BINARY_PATH;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = (req.query["url"] as string) || "https://example.com";
  const format = (req.query["format"] as string) || "markdown";

  if (!["html", "markdown", "semantic_tree", "semantic_tree_text"].includes(format)) {
    res.status(400).json({ error: "Invalid format. Use: html, markdown, semantic_tree, semantic_tree_text" });
    return;
  }

  try {
    const binary = await getExecutablePath();
    // TODO: Zig's std.crypto.Certificate.Bundle.rescan() doesn't load certs
    // correctly on AL2023/Lambda. This needs an upstream fix in Lightpanda.
    // Using --insecure_disable_tls_host_verification as a temporary workaround.
    const args = [
      "fetch", url,
      "--dump", format,
      "--insecure_disable_tls_host_verification",
    ];

    const { stdout } = await execFile(binary, args, {
      env: { ...process.env, HOME: tmpdir() },
      maxBuffer: 100 * 1024 * 1024,
      timeout: 25_000,
    });

    const contentType = format === "html" ? "text/html" : "text/plain";
    res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
    res.status(200).send(stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
