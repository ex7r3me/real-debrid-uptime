/**
 * HTTP API routes: /status/current, /status/history, /health, /cache.
 */

import { readAll, append, type HistoryEntry, type ApiRecord } from "../storage.js";
import { getSchedulerState } from "../scheduler.js";
import { getApiKey } from "../config.js";
import { getCacheList, getInstantAvailabilityRaw, checkUser } from "../rdClient.js";

export function handleStatusCurrent(): { status: number; body: string } {
  const entries = readAll();
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  if (!latest) {
    return { status: 404, body: JSON.stringify({ error: "no data yet" }) };
  }
  return { status: 200, body: JSON.stringify(latest) };
}

export function handleStatusHistory(
  from?: string,
  to?: string,
  streamId?: string
): { status: number; body: string } {
  let entries = readAll();
  if (from) {
    const t = new Date(from).getTime();
    if (!Number.isNaN(t)) entries = entries.filter((e) => new Date(e.timestamp).getTime() >= t);
  }
  if (to) {
    const t = new Date(to).getTime();
    if (!Number.isNaN(t)) entries = entries.filter((e) => new Date(e.timestamp).getTime() <= t);
  }
  if (streamId && streamId.trim()) {
    const points = entries
      .filter((e) => e.streams?.[streamId])
      .map((e) => ({ timestamp: e.timestamp, ...e.streams![streamId] }));
    return { status: 200, body: JSON.stringify(points) };
  }
  return { status: 200, body: JSON.stringify(entries) };
}

/** POST /status/check — run API availability test on demand and append to history. */
export async function handleCheckApi(): Promise<{ status: number; body: string }> {
  const token = getApiKey();
  if (!token) {
    return { status: 401, body: JSON.stringify({ error: "REAL_DEBRID_API_KEY not set" }) };
  }
  const result = await checkUser(token);
  const apiRecord: ApiRecord = {
    success: result.success,
    responseTimeMs: result.responseTimeMs,
    httpStatus: result.httpStatus,
    ...(result.error && { error: result.error }),
  };
  const entry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    api: apiRecord,
    streams: {},
  };
  append(entry);
  const body = JSON.stringify({
    success: result.success,
    responseTimeMs: result.responseTimeMs,
    httpStatus: result.httpStatus,
    ...(result.error && { error: result.error }),
  });
  return { status: 200, body };
}

export function handleHealth(): { status: number; body: string } {
  const st = getSchedulerState();
  const uptimeMs = st.startTime
    ? Date.now() - new Date(st.startTime).getTime()
    : 0;
  const body = JSON.stringify({
    uptimeMs,
    startTime: st.startTime,
    lastRun: st.lastRun,
    lastError: st.lastError,
  });
  return { status: 200, body };
}

/** GET /cache — list cached items by hash so you can pick for streams.json. */
export async function handleCacheList(): Promise<{ status: number; body: string }> {
  const token = getApiKey();
  if (!token) {
    return { status: 401, body: JSON.stringify({ error: "REAL_DEBRID_API_KEY not set" }) };
  }
  const result = await getCacheList(token);
  if (!result.success) {
    return {
      status: result.httpStatus ?? 500,
      body: JSON.stringify({ error: result.error ?? "Failed to fetch cache list" }),
    };
  }
  const body = JSON.stringify({
    items: result.items,
    hint: "Copy 'hash' from any item into streams.json (id, type: \"hash\", hash). Prefer status 'downloaded' and cached.",
  });
  return { status: 200, body };
}

/** GET /cache/instant?hash=XXX — debug: raw instant-availability response for one hash. */
export async function handleCacheInstant(hash: string): Promise<{ status: number; body: string }> {
  const token = getApiKey();
  if (!token) {
    return { status: 401, body: JSON.stringify({ error: "REAL_DEBRID_API_KEY not set" }) };
  }
  if (!hash || hash.length < 10) {
    return { status: 400, body: JSON.stringify({ error: "Query param hash= required (info hash)" }) };
  }
  const result = await getInstantAvailabilityRaw(token, hash);
  const body = JSON.stringify({
    hash,
    httpStatus: result.httpStatus,
    raw: result.raw,
    error: result.error,
    hint: "If raw is {} or missing your hash key, that hash is not in Real-Debrid's instant cache.",
  });
  return { status: 200, body };
}
