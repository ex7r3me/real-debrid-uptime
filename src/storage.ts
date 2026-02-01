/**
 * Local persistence: append-only records, auto-prune older than 7 days.
 * Storage path directory is created if missing.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { getStoragePath } from "./config.js";

export interface ApiRecord {
  success: boolean;
  responseTimeMs: number;
  httpStatus: number;
  error?: string;
}

export interface StreamRecord {
  success: boolean;
  apiResponseTimeMs?: number;
  ttfbMs?: number;
  httpStatus?: number;
  cdnHost?: string;
  errorType?: string;
  /** Why the check failed (e.g. instant_unavailable, no_links); only when success is false */
  failureStep?: string;
}

export interface HistoryEntry {
  timestamp: string;
  api?: ApiRecord;
  streams?: Record<string, StreamRecord>;
}

const RETENTION_DAYS = 7;
const MAX_AGE_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadEntries(path: string): HistoryEntry[] {
  ensureDir(path);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as HistoryEntry);
  } catch {
    return [];
  }
}

function prune(entries: HistoryEntry[]): HistoryEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);
}

/**
 * Append one record and prune entries older than 7 days.
 */
export function append(entry: HistoryEntry): void {
  const path = getStoragePath();
  const entries = loadEntries(path);
  entries.push(entry);
  const pruned = prune(entries);
  ensureDir(path);
  const content = pruned.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, content, "utf-8");
}

/**
 * Read all entries (already pruned on each append; this does not prune again).
 */
export function readAll(): HistoryEntry[] {
  const path = getStoragePath();
  return prune(loadEntries(path));
}

/**
 * Ensure storage directory exists (e.g. ./data). Call at startup.
 */
export function ensureStoragePath(): void {
  ensureDir(getStoragePath());
}
