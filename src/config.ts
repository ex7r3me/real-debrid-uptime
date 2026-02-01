/**
 * Environment and streams config. CHECK_INTERVAL_SECONDS is read on each use so it can be reloaded at runtime.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

export type StreamDef =
  | { id: string; type: "hash"; hash: string }
  | { id: string; type: "download"; url: string };

export interface StreamsConfig {
  apiCheck: boolean;
  streams: StreamDef[];
}

const DEFAULT_STORAGE_PATH = "./data/history.json";
const DEFAULT_CHECK_INTERVAL_SECONDS = 300;
const DEFAULT_PORT = 3000;

/** API key from env (required for running checks). */
export function getApiKey(): string | undefined {
  return process.env.REAL_DEBRID_API_KEY;
}

/** Check interval in seconds; reloadable at runtime. */
export function getCheckIntervalSeconds(): number {
  const raw = process.env.CHECK_INTERVAL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_CHECK_INTERVAL_SECONDS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CHECK_INTERVAL_SECONDS;
  return n;
}

/** Storage file path; resolved relative to process cwd. */
export function getStoragePath(): string {
  const path = process.env.STORAGE_PATH ?? DEFAULT_STORAGE_PATH;
  return path.startsWith("/") ? path : resolve(process.cwd(), path);
}

/** HTTP server port. */
export function getPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PORT;
  return n;
}

/** Path to streams config file (e.g. streams.json). */
export function getStreamsConfigPath(): string {
  return resolve(projectRoot, "streams.json");
}

/** Path to frontend build output (for serving UI). */
export function getFrontendDistPath(): string {
  return resolve(projectRoot, "frontend", "dist");
}

let cachedStreamsConfig: StreamsConfig | null = null;

/** Streams config from streams.json; re-read on each call so file changes apply. */
export function getStreamsConfig(): StreamsConfig {
  if (cachedStreamsConfig) return cachedStreamsConfig;
  const path = getStreamsConfigPath();
  if (!existsSync(path)) {
    cachedStreamsConfig = { apiCheck: true, streams: [] };
    return cachedStreamsConfig;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as StreamsConfig;
    if (!parsed || typeof parsed.apiCheck !== "boolean") {
      cachedStreamsConfig = { apiCheck: true, streams: [] };
      return cachedStreamsConfig;
    }
    const streams = Array.isArray(parsed.streams)
      ? parsed.streams.filter((s): s is StreamDef => {
          if (!s || typeof s.id !== "string") return false;
          if (s.type === "hash" && typeof s.hash === "string") return true;
          if (s.type === "download" && typeof s.url === "string") return true;
          return false;
        })
      : [];
    cachedStreamsConfig = { apiCheck: parsed.apiCheck, streams };
    return cachedStreamsConfig;
  } catch {
    cachedStreamsConfig = { apiCheck: true, streams: [] };
    return cachedStreamsConfig;
  }
}

/** Clear cached streams config so next getStreamsConfig() re-reads the file. */
export function clearStreamsConfigCache(): void {
  cachedStreamsConfig = null;
}
