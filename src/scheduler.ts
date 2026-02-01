/**
 * Interval logic: runs checks every N seconds; N is reloadable at runtime.
 * Graceful shutdown: finishes in-flight check before exiting.
 */

import { getApiKey, getCheckIntervalSeconds, getStreamsConfig } from "./config.js";
import { checkUser } from "./rdClient.js";
import { checkStream } from "./streamChecker.js";
import { append, type HistoryEntry, type ApiRecord, type StreamRecord } from "./storage.js";

export interface SchedulerState {
  lastRun: string | null;
  lastError: string | null;
  startTime: string;
}

const state: SchedulerState = {
  lastRun: null,
  lastError: null,
  startTime: new Date().toISOString(),
};

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let stopping = false;

export function getSchedulerState(): SchedulerState {
  return { ...state };
}

async function runCheck(): Promise<void> {
  const token = getApiKey();
  const config = getStreamsConfig();

  const entry: HistoryEntry = {
    timestamp: new Date().toISOString(),
  };

  try {
    if (config.apiCheck && token) {
      const apiResult = await checkUser(token);
      const apiRecord: ApiRecord = {
        success: apiResult.success,
        responseTimeMs: apiResult.responseTimeMs,
        httpStatus: apiResult.httpStatus,
        ...(apiResult.error && { error: apiResult.error }),
      };
      entry.api = apiRecord;
    }

    if (config.streams.length > 0 && token) {
      entry.streams = {};
      for (const stream of config.streams) {
        try {
          const result = await checkStream(token, stream.id, stream);
          const record: StreamRecord = {
            success: result.success,
            ...(result.apiResponseTimeMs != null && {
              apiResponseTimeMs: result.apiResponseTimeMs,
            }),
            ...(result.ttfbMs != null && { ttfbMs: result.ttfbMs }),
            ...(result.httpStatus != null && { httpStatus: result.httpStatus }),
            ...(result.cdnHost != null && { cdnHost: result.cdnHost }),
            ...(result.errorType != null && { errorType: result.errorType }),
            ...(result.failureStep != null && { failureStep: result.failureStep }),
          };
          entry.streams[stream.id] = record;
        } catch (err) {
          entry.streams[stream.id] = {
            success: false,
            errorType: "unknown",
          };
        }
      }
    }

    append(entry);
    state.lastRun = entry.timestamp;
    state.lastError = null;

    const streamCounts = entry.streams
      ? Object.values(entry.streams).reduce(
          (acc, s) => (s.success ? { ...acc, ok: acc.ok + 1 } : { ...acc, fail: acc.fail + 1 }),
          { ok: 0, fail: 0 }
        )
      : { ok: 0, fail: 0 };
    const logLine: Record<string, unknown> = {
      msg: "check_complete",
      timestamp: entry.timestamp,
      api: entry.api?.success ? "ok" : "fail",
      ...(entry.api && { apiStatus: entry.api.httpStatus, apiError: entry.api.error }),
      streams: streamCounts,
    };
    if (entry.api?.httpStatus === 401) {
      logLine.hint = "REAL_DEBRID_API_KEY may be invalid or expired — check .env and https://real-debrid.com/apitoken";
    }
      if (entry.streams && streamCounts.fail > 0) {
      const streamReasons: Record<string, string> = {};
      for (const [id, rec] of Object.entries(entry.streams)) {
        if (!rec.success && rec.failureStep) streamReasons[id] = rec.failureStep;
      }
      if (Object.keys(streamReasons).length) logLine.streamReasons = streamReasons;
      const streamRefs: Record<string, string> = {};
      for (const s of config.streams) {
        if (s.type === "hash" && "hash" in s) streamRefs[s.id] = s.hash;
        if (s.type === "download" && "url" in s) streamRefs[s.id] = s.url;
      }
      if (Object.keys(streamRefs).length) logLine.streamRefs = streamRefs;
    }
    console.log(JSON.stringify(logLine));
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    console.log(
      JSON.stringify({
        msg: "check_error",
        error: state.lastError,
      })
    );
  } finally {
    inFlight = false;
    if (!stopping) scheduleNext();
  }
}

function scheduleNext(): void {
  if (timeoutId != null) return;
  const ms = getCheckIntervalSeconds() * 1000;
  timeoutId = setTimeout(() => {
    timeoutId = null;
    if (!inFlight) {
      inFlight = true;
      runCheck();
    }
  }, ms);
}

export function start(): void {
  if (inFlight) return;
  inFlight = true;
  runCheck();
}

export function stop(): Promise<void> {
  stopping = true;
  if (timeoutId != null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  return new Promise((resolve) => {
    const check = () => {
      if (!inFlight) {
        resolve();
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

export function isInFlight(): boolean {
  return inFlight;
}
