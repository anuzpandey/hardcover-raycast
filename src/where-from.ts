import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const PLUTIL = "/usr/bin/plutil";
const XATTR = "/usr/bin/xattr";

/** The attribute Finder shows as "Where from" in Get Info. */
export const WHERE_FROM = "com.apple.metadata:kMDItemWhereFroms";

/**
 * Stamps a file the way Safari stamps a download: the file's own URL, then the
 * page it came from. Folder automations (Hazel, Folder Actions) can match on
 * it, so a cover landing in ~/Downloads can be routed by source.
 *
 * The value has to be a binary plist array, so plutil builds it from JSON and
 * xattr writes the bytes as hex. Local metadata only: git and rsync drop it.
 */
export async function setWhereFrom(
  path: string,
  urls: string[],
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "hc-wherefrom-"));
  const source = join(directory, "urls.json");
  const target = join(directory, "urls.plist");

  try {
    await writeFile(source, JSON.stringify(urls));
    await run(PLUTIL, ["-convert", "binary1", "-o", target, source]);

    const hex = (await readFile(target)).toString("hex");

    await run(XATTR, ["-wx", WHERE_FROM, hex, path]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Reads the attribute back, or [] when the file has none. */
export async function whereFrom(path: string): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), "hc-wherefrom-"));
  const target = join(directory, "urls.plist");

  try {
    const { stdout } = await run(XATTR, ["-px", WHERE_FROM, path]);

    await writeFile(target, Buffer.from(stdout.replace(/\s+/g, ""), "hex"));

    const { stdout: json } = await run(PLUTIL, [
      "-convert",
      "json",
      "-o",
      "-",
      target,
    ]);

    return JSON.parse(json) as string[];
  } catch {
    return [];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
