import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/config/env";
import { uuidv7 } from "@/lib/ids";

/**
 * Local disk storage for uploads (one VPS, backed up with the server).
 * Keys look like "<tenantId>/<uuid>" and never contain user input.
 */
function root(): string {
  // Runtime data folder: keep it out of build tracing.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), serverEnv().FILE_STORAGE_DIR);
}

function resolveKey(key: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Bad storage key");
  const full = path.resolve(/* turbopackIgnore: true */ root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Bad storage key");
  return full;
}

export async function storeFile(tenantId: string, data: Uint8Array): Promise<string> {
  const key = `${tenantId}/${uuidv7()}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function loadFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function removeFile(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}
