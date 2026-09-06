import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Raycast does not inherit the shell's PATH, so `cwebp` has to be found by
 * absolute path rather than by name. These are where Homebrew and MacPorts put
 * it on Apple Silicon and Intel respectively.
 */
const CWEBP_PATHS = [
  "/opt/homebrew/bin/cwebp",
  "/usr/local/bin/cwebp",
  "/opt/local/bin/cwebp",
];

const SIPS = "/usr/bin/sips";

let resolved: string | null | undefined;

export function cwebpPath(): string | null {
  if (resolved === undefined) {
    resolved = CWEBP_PATHS.find((path) => existsSync(path)) ?? null;
  }

  return resolved;
}

/** Whether WebP output is actually possible on this machine right now. */
export function webpAvailable(): boolean {
  return cwebpPath() !== null;
}

export interface ConvertOptions {
  maxHeight: number;
  quality: number;
}

/**
 * Re-encodes a cover as WebP, shrinking it to maxHeight when it is taller.
 *
 * The resize is where the saving actually comes from: on a 977x1500 cover,
 * WebP alone was 12% smaller, while dropping it to 900px tall was 58%.
 *
 * sips cannot write WebP -- it reads the format but fails with "Can't write
 * format: org.webmproject.webp" -- so cwebp does the encoding, and sips is used
 * only to read the source height.
 */
export async function toWebp(
  input: Buffer,
  options: ConvertOptions,
): Promise<Buffer> {
  const binary = cwebpPath();

  if (!binary) {
    throw new Error("cwebp not found. Install it with `brew install webp`.");
  }

  const directory = await mkdtemp(join(tmpdir(), "hc-webp-"));
  const source = join(directory, "source");
  const target = join(directory, "target.webp");

  try {
    await writeFile(source, input);

    const args = ["-quiet", "-q", String(options.quality)];
    const height = await imageHeight(source);

    // Only ever shrink. Upscaling a small cover to the target height would
    // make it blurrier and larger at the same time.
    if (height !== null && height > options.maxHeight) {
      args.push("-resize", "0", String(options.maxHeight));
    }

    args.push(source, "-o", target);

    await run(binary, args);

    return await readFile(target);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function imageHeight(path: string): Promise<number | null> {
  try {
    const { stdout } = await run(SIPS, ["-g", "pixelHeight", path]);
    const match = stdout.match(/pixelHeight:\s*(\d+)/);

    return match ? Number.parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
