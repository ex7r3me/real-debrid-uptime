/**
 * API types and fetch helpers for Real-Debrid Uptime Monitor.
 */

const API = ""; // same origin

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
  failureStep?: string;
}

export interface HistoryEntry {
  timestamp: string;
  api?: ApiRecord;
  streams?: Record<string, StreamRecord>;
}

export interface HealthResponse {
  uptimeMs: number;
  startTime: string | null;
  lastRun: string | null;
  lastError: string | null;
}

export interface CheckApiResponse {
  success: boolean;
  responseTimeMs: number;
  httpStatus: number;
  error?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "API returned non-JSON (is the monitor running on this host?). " +
        "Run the backend and open this app from the same origin, or use the Vite proxy in dev."
    );
  }
}

export async function fetchStatusCurrent(): Promise<HistoryEntry> {
  return get<HistoryEntry>("/status/current");
}

export async function fetchStatusHistory(params?: {
  from?: string;
  to?: string;
  streamId?: string;
}): Promise<HistoryEntry[] | Array<{ timestamp: string } & StreamRecord>> {
  const sp = new URLSearchParams();
  if (params?.from) sp.set("from", params.from);
  if (params?.to) sp.set("to", params.to);
  if (params?.streamId) sp.set("streamId", params.streamId);
  const q = sp.toString();
  return get(`/status/history${q ? `?${q}` : ""}`);
}

export async function fetchHealth(): Promise<HealthResponse> {
  return get<HealthResponse>("/health");
}

export async function fetchCheckApi(): Promise<CheckApiResponse> {
  const res = await fetch(`${API}/status/check`, { method: "POST" });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  try {
    return JSON.parse(text) as CheckApiResponse;
  } catch {
    throw new Error("API returned non-JSON.");
  }
}
