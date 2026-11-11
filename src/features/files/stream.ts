import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { serverEnv } from "@/config/env";

/*
 * Streams a stored upload from the local-disk backend instead of buffering it.
 * `@/server/storage` has no stream API yet, so this mirrors its key rules exactly:
 * keys are "<tenantId>/<uuid>" and must resolve inside FILE_STORAGE_DIR.
 */

function storageRoot(): string {
  // Runtime data folder: keep it out of build tracing.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), serverEnv().FILE_STORAGE_DIR);
}

function storedPath(key: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Bad storage key");
  const root = storageRoot();
  const full = path.resolve(/* turbopackIgnore: true */ root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Bad storage key");
  return full;
}

/** A web stream of the stored file and its size on disk, or null when the file is gone. */
export async function openStoredFile(
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const full = storedPath(key);
  let size: number;
  try {
    const info = await stat(full);
    if (!info.isFile()) return null;
    size = info.size;
  } catch {
    return null;
  }
  // Node's web stream type and the DOM one are the same object at runtime.
  const stream = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream<Uint8Array>;
  return { stream, size };
}
