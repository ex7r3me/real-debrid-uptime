/**
 * Streaming health checks: instant availability, unrestrict link, CDN HEAD/GET for TTFB.
 */

import {
  getCacheList,
  getCacheInfo,
  getDownloadsList,
  unrestrictLink,
} from "./rdClient.js";
import type { StreamDef } from "./config.js";

const REQUEST_TIMEOUT_MS = 30_000;

export type StreamErrorType =
  | "timeout"
  | "rate_limit"
  | "forbidden"
  | "server_error"
  | "network"
  | "unknown";

export type StreamFailureStep =
  | "instant_unavailable"
  | "add_magnet_failed"
  | "select_files_failed"
  | "no_links"
  | "unrestrict_failed"
  | "cdn_head_failed"
  | "cache_not_in_account"
  | "download_not_found";

export interface StreamCheckResult {
  success: boolean;
  apiResponseTimeMs?: number;
  ttfbMs?: number;
  httpStatus?: number;
  cdnHost?: string;
  errorType?: StreamErrorType;
  /** Why the check failed (for logging); only set when success is false */
  failureStep?: StreamFailureStep;
}

function classifyError(status: number, message?: string): StreamErrorType {
  if (status === 429) return "rate_limit";
  if (status === 403) return "forbidden";
  if (status >= 500) return "server_error";
  if (status === 0 || message?.toLowerCase().includes("timeout")) return "timeout";
  if (
    message?.toLowerCase().includes("fetch") ||
    message?.toLowerCase().includes("network") ||
    message?.toLowerCase().includes("econnrefused")
  )
    return "network";
  return "unknown";
}

/** Extract hostname from URL (e.g. rbx-cdn.real-debrid.com). */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** HEAD request with TTFB; fallback to GET with Range if HEAD fails or is not supported. */
async function headWithTtfb(
  url: string
): Promise<{ ttfbMs: number; httpStatus: number; host: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    const ttfbMs = Date.now() - start;
    clearTimeout(timeout);
    if (res.ok) {
      return { ttfbMs, httpStatus: res.status, host: hostFromUrl(res.url) };
    }
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: new AbortController().signal,
      });
      const ttfbGet = Date.now() - start;
      return {
        ttfbMs: ttfbGet,
        httpStatus: getRes.status,
        host: hostFromUrl(getRes.url),
      };
    }
    return { ttfbMs, httpStatus: res.status, host: hostFromUrl(res.url) };
  } catch {
    clearTimeout(timeout);
    const ttfbMs = Date.now() - start;
    try {
      const getRes = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
      });
      return {
        ttfbMs: Date.now() - start,
        httpStatus: getRes.status,
        host: hostFromUrl(getRes.url),
      };
    } catch {
      return {
        ttfbMs,
        httpStatus: 0,
        host: hostFromUrl(url),
      };
    }
  }
}

/** Extract download ID from real-debrid.com/d/ID URL. */
function parseDownloadId(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/d\/([^/?#]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check stream by Real-Debrid download URL (e.g. https://real-debrid.com/d/EGGIJCYACQYH2E68).
 * Lists downloads, finds by ID, HEADs the direct download link. No add/delete.
 */
async function checkStreamByUrl(
  token: string,
  _streamId: string,
  url: string
): Promise<StreamCheckResult> {
  const apiStart = Date.now();
  const id = parseDownloadId(url);
  if (!id) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      errorType: "unknown",
      failureStep: "download_not_found",
    };
  }
  const list = await getDownloadsList(token);
  if (!list.success || !list.downloads) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      httpStatus: list.httpStatus ?? 0,
      errorType: list.httpStatus ? classifyError(list.httpStatus) : "unknown",
      failureStep: "download_not_found",
    };
  }
  const download = list.downloads.find((d) => d.id === id);
  if (!download?.download) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      errorType: "unknown",
      failureStep: "download_not_found",
    };
  }
  const apiResponseTimeMs = Date.now() - apiStart;
  const { ttfbMs, httpStatus, host } = await headWithTtfb(download.download);
  const success = httpStatus >= 200 && httpStatus < 400;
  return {
    success,
    apiResponseTimeMs,
    ttfbMs,
    httpStatus,
    cdnHost: host || download.host,
    ...(httpStatus >= 400 && {
      errorType: classifyError(httpStatus) as StreamErrorType,
      failureStep: "cdn_head_failed" as const,
    }),
  };
}

/**
 * Check stream by hash: use existing cached item in account (no add/delete).
 * Find by hash → get links → unrestrict first link → HEAD for TTFB.
 */
async function checkStreamByHash(
  token: string,
  _streamId: string,
  hash: string
): Promise<StreamCheckResult> {
  const apiStart = Date.now();
  const list = await getCacheList(token);
  if (!list.success || !list.items) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      httpStatus: list.httpStatus ?? 0,
      errorType: list.httpStatus ? classifyError(list.httpStatus) : "unknown",
      failureStep: "cache_not_in_account",
    };
  }
  const hashLower = hash.toLowerCase();
  const cache = list.items.find((t) => t.hash.toLowerCase() === hashLower);
  if (!cache) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      errorType: "unknown",
      failureStep: "cache_not_in_account",
    };
  }
  const info = await getCacheInfo(token, cache.id);
  if (!info.success || !info.info?.links?.length) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      errorType: "unknown",
      failureStep: "no_links",
    };
  }
  const unrestrict = await unrestrictLink(token, info.info.links[0]);
  if (!unrestrict.success || !unrestrict.download) {
    return {
      success: false,
      apiResponseTimeMs: Date.now() - apiStart,
      httpStatus: unrestrict.httpStatus ?? 0,
      errorType: unrestrict.httpStatus
        ? classifyError(unrestrict.httpStatus)
        : "unknown",
      failureStep: "unrestrict_failed",
    };
  }
  const apiResponseTimeMs = Date.now() - apiStart;
  const { ttfbMs, httpStatus, host } = await headWithTtfb(unrestrict.download);
  const success = httpStatus >= 200 && httpStatus < 400;
  return {
    success,
    apiResponseTimeMs,
    ttfbMs,
    httpStatus,
    cdnHost: host || unrestrict.host,
    ...(httpStatus >= 400 && {
      errorType: classifyError(httpStatus) as StreamErrorType,
      failureStep: "cdn_head_failed" as const,
    }),
  };
}

/**
 * Run stream check: by hash (existing cached item in account) or by URL (real-debrid.com/d/ID).
 * No add/delete — only list, unrestrict if needed, and HEAD the stream URL.
 */
export async function checkStream(
  token: string,
  streamId: string,
  stream: StreamDef
): Promise<StreamCheckResult> {
  try {
    if (stream.type === "download" && "url" in stream) {
      return checkStreamByUrl(token, streamId, stream.url);
    }
    if (stream.type === "hash" && "hash" in stream) {
      return checkStreamByHash(token, streamId, stream.hash);
    }
    return {
      success: false,
      apiResponseTimeMs: 0,
      errorType: "unknown",
      failureStep: "cache_not_in_account",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      apiResponseTimeMs: 0,
      errorType: classifyError(0, message),
    };
  }
}
