import { createReadStream, createWriteStream, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrotliDecompress } from "node:zlib";

const BINARY_NAME = "lightpanda";

/**
 * Decompresses a brotli-compressed Lightpanda binary to /tmp and makes it executable.
 * Returns the path to the decompressed binary.
 * Skips decompression on warm starts if the binary already exists.
 */
export const inflate = (compressedPath: string): Promise<string> => {
  const output = join(tmpdir(), BINARY_NAME);

  return new Promise((resolve, reject) => {
    if (existsSync(output)) {
      resolve(output);
      return;
    }

    const source = createReadStream(compressedPath, { highWaterMark: 2 ** 22 });
    const decompressor = createBrotliDecompress({ chunkSize: 2 ** 21 });
    const target = createWriteStream(output, { mode: 0o755 });

    const handleError = (error: Error) => {
      reject(error);
    };

    source.once("error", handleError);
    decompressor.once("error", handleError);
    target.once("error", handleError);

    target.once("close", () => {
      chmodSync(output, 0o755);
      resolve(output);
    });

    source.pipe(decompressor).pipe(target);
  });
};
