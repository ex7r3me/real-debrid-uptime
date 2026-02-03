import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { HistoryEntry, HealthResponse, StreamRecord, CheckApiResponse } from "./api";
import {
  fetchStatusCurrent,
  fetchStatusHistory,
  fetchHealth,
  fetchCheckApi,
} from "./api";
import "./App.css";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface Outage {
  id: string;
  type: "api" | "stream";
  streamId?: string;
  start: string;
  end: string;
  durationMs: number;
}

/** Derive outages from history: consecutive failures for API or each stream. */
function computeOutages(entries: HistoryEntry[]): Outage[] {
  const list: Outage[] = [];
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  function addOutage(
    type: "api" | "stream",
    streamId: string | undefined,
    start: string,
    end: string
  ) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (endMs <= startMs) return;
    list.push({
      id: `${type}-${streamId ?? "api"}-${start}`,
      type,
      streamId,
      start,
      end,
      durationMs: endMs - startMs,
    });
  }

  // API outages
  let apiOutageStart: string | null = null;
  for (const e of sorted) {
    const ok = e.api?.success ?? true;
    if (!ok && !apiOutageStart) apiOutageStart = e.timestamp;
    if (ok && apiOutageStart) {
      addOutage("api", undefined, apiOutageStart, e.timestamp);
      apiOutageStart = null;
    }
  }
  if (apiOutageStart) {
    const last = sorted[sorted.length - 1];
    const stillDown = last && last.api?.success === false;
    const end = stillDown ? new Date().toISOString() : (last?.timestamp ?? apiOutageStart);
    addOutage("api", undefined, apiOutageStart, end);
  }

  // Stream outages (per stream)
  const streamIds = new Set<string>();
  for (const e of sorted) {
    if (e.streams) for (const id of Object.keys(e.streams)) streamIds.add(id);
  }
  for (const streamId of streamIds) {
    let start: string | null = null;
    for (const e of sorted) {
      const s = e.streams?.[streamId];
      const ok = s?.success ?? true;
      if (!ok && !start) start = e.timestamp;
      if (ok && start) {
        addOutage("stream", streamId, start, e.timestamp);
        start = null;
      }
    }
    if (start) {
      const last = sorted[sorted.length - 1];
      const stillDown = last && last.streams?.[streamId]?.success === false;
      const end = stillDown ? new Date().toISOString() : (last?.timestamp ?? start);
      addOutage("stream", streamId, start, end);
    }
  }

  list.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  return list.slice(0, 20);
}

/** Uptime status for a bucket: up, down, or no data. */
type BucketStatus = "up" | "down" | "none";

export interface UptimeBucket {
  key: string;
  label: string;
  api: BucketStatus;
  streams: Record<string, BucketStatus>;
}

/** Build uptime grid: last N hours, one column per hour. Rows = API + stream ids. */
function buildUptimeGridHours(
  entries: HistoryEntry[],
  streamIds: string[],
  hours: number = 12
): { rows: { id: string; label: string; type: "api" | "stream" }[]; buckets: UptimeBucket[] } {
  const now = new Date();
  const hourMs = 60 * 60 * 1000;
  const buckets: UptimeBucket[] = [];
  for (let h = hours - 1; h >= 0; h--) {
    const hourStart = new Date(now.getTime() - h * hourMs);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + hourMs);
    const hourEntries = entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= hourStart.getTime() && t < hourEnd.getTime();
    });
    const apiStatus: BucketStatus =
      hourEntries.some((e) => e.api?.success === false)
        ? "down"
        : hourEntries.some((e) => e.api?.success === true)
          ? "up"
          : "none";
    const streams: Record<string, BucketStatus> = {};
    for (const id of streamIds) {
      const withStream = hourEntries.filter((e) => e.streams?.[id] != null);
      streams[id] = withStream.some((e) => e.streams?.[id]?.success === false)
        ? "down"
        : withStream.some((e) => e.streams?.[id]?.success === true)
          ? "up"
          : "none";
    }
    const label = hourStart.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    buckets.push({
      key: hourStart.toISOString(),
      label,
      api: apiStatus,
      streams,
    });
  }
  const rows = [
    { id: "api", label: "API", type: "api" as const },
    ...streamIds.map((id) => ({ id, label: id, type: "stream" as const })),
  ];
  return { rows, buckets };
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function CurrentStatus({
  entry,
  onCheckApi,
  checkApiLoading,
  checkApiResult,
  checkApiError,
}: {
  entry: HistoryEntry | null;
  onCheckApi: () => void;
  checkApiLoading: boolean;
  checkApiResult: CheckApiResponse | null;
  checkApiError: string | null;
}) {
  const api = entry?.api;
  const streams = entry?.streams ?? {};
  const streamIds = Object.keys(streams);

  return (
    <section className="card">
      <h2>Current status</h2>
      {entry ? (
        <p className="meta">{formatTime(entry.timestamp)}</p>
      ) : (
        <p className="muted">No data yet. Wait for the first check or test the API now.</p>
      )}
      {api && (
        <div className="api-status">
          <span className={`badge ${api.success ? "ok" : "fail"}`}>
            API {api.success ? "OK" : "Fail"}
          </span>
          {api.responseTimeMs != null && (
            <span className="muted"> {api.responseTimeMs} ms</span>
          )}
          {api.error && <span className="error"> — {api.error}</span>}
        </div>
      )}
      <div className="check-api-row">
        <button
          type="button"
          className="btn-check"
          onClick={onCheckApi}
          disabled={checkApiLoading}
        >
          {checkApiLoading ? "Testing…" : "Test API now"}
        </button>
        {checkApiResult && (
          <span className={`check-result ${checkApiResult.success ? "ok" : "fail"}`}>
            {checkApiResult.success ? "OK" : "Fail"}
            {checkApiResult.responseTimeMs != null && ` · ${checkApiResult.responseTimeMs} ms`}
            {checkApiResult.error && ` · ${checkApiResult.error}`}
          </span>
        )}
        {checkApiError && <span className="error">{checkApiError}</span>}
      </div>
      <div className="streams">
        {streamIds.map((id) => {
          const s = streams[id] as StreamRecord;
          const ok = s?.success;
          return (
            <div key={id} className="stream-row">
              <span className={`badge ${ok ? "ok" : "fail"}`}>{id}</span>
              {ok ? (
                <>
                  {s.ttfbMs != null && (
                    <span className="muted">TTFB {s.ttfbMs} ms</span>
                  )}
                  {s.cdnHost && (
                    <span className="muted"> · {s.cdnHost}</span>
                  )}
                </>
              ) : (
                <span className="error">
                  {s?.failureStep ?? s?.errorType ?? "failed"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Health({ health }: { health: HealthResponse | null }) {
  if (!health) return null;
  return (
    <section className="card health">
      <h2>Service health</h2>
      <dl className="health-dl">
        <dt>Uptime</dt>
        <dd>{formatUptime(health.uptimeMs)}</dd>
        <dt>Last run</dt>
        <dd>{health.lastRun ? formatTime(health.lastRun) : "—"}</dd>
        {health.lastError && (
          <>
            <dt>Last error</dt>
            <dd className="error">{health.lastError}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

const STREAM_COLORS: Record<string, string> = {
  tv: "#a78bfa",
  movie: "#22c55e",
  animation: "#f59e0b",
};

/** Max history points to keep in memory and render (avoids unbounded growth + heavy chart). */
const MAX_CHART_POINTS = 300;

function HistoryChartAll({
  entries,
  streamIds,
}: {
  entries: HistoryEntry[];
  streamIds: string[];
}) {
  const chartData = useMemo(() => {
    const slice = entries.slice(-MAX_CHART_POINTS);
    return slice.map((e) => {
      const row: Record<string, string | number | null> = {
        time: formatTime(e.timestamp),
        timestamp: e.timestamp,
      };
      for (const id of streamIds) {
        row[id] = e.streams?.[id]?.ttfbMs ?? null;
      }
      return row;
    });
  }, [entries, streamIds.join(",")]);

  if (!chartData.length) return <p className="muted">No history yet.</p>;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
          <XAxis dataKey="time" tick={{ fill: "var(--muted)" }} fontSize={11} />
          <YAxis
            tick={{ fill: "var(--muted)" }}
            fontSize={11}
            label={{ value: "TTFB (ms)", angle: -90, position: "insideLeft", fill: "var(--muted)" }}
          />
          <Tooltip
            contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border)" }}
            labelStyle={{ color: "var(--text)" }}
            formatter={(value: number | undefined, name: string | undefined) => [value ?? "—", name ?? ""]}
            labelFormatter={(label) => label}
          />
          <Legend />
          {streamIds.map((id) => (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              name={id}
              stroke={STREAM_COLORS[id] ?? "var(--accent)"}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const UPTIME_HOURS = 12;

function UptimeGrid({ entries, streamIds }: { entries: HistoryEntry[]; streamIds: string[] }) {
  const { rows, buckets } = useMemo(
    () => buildUptimeGridHours(entries, streamIds, UPTIME_HOURS),
    [entries, streamIds.join(",")]
  );
  if (!buckets.length) return <p className="muted">No history yet.</p>;

  return (
    <div className="uptime-grid-wrap">
      <div className="uptime-grid">
        <div className="uptime-grid-header">
          <span className="uptime-grid-label" />
          {buckets.map((b) => (
            <span key={b.key} className="uptime-grid-hour" title={new Date(b.key).toLocaleString()}>
              {b.label}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.id} className="uptime-grid-row">
            <span className="uptime-grid-label" title={row.label}>
              {row.label}
            </span>
            <div className="uptime-grid-cells">
              {buckets.map((b) => {
                const status = row.type === "api" ? b.api : b.streams[row.id] ?? "none";
                return (
                  <span
                    key={`${row.id}-${b.key}`}
                    className={`uptime-cell uptime-cell--${status}`}
                    title={`${row.label} · ${b.label}: ${status === "up" ? "Operational" : status === "down" ? "Outage" : "No data"}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="uptime-legend">
        <span className="uptime-legend-item">
          <span className="uptime-cell uptime-cell--up" />
          Operational
        </span>
        <span className="uptime-legend-item">
          <span className="uptime-cell uptime-cell--down" />
          Outage
        </span>
        <span className="uptime-legend-item">
          <span className="uptime-cell uptime-cell--none" />
          No data
        </span>
      </div>
    </div>
  );
}

function OutagesList({ outages }: { outages: Outage[] }) {
  if (!outages.length) return <p className="muted">No recorded outages.</p>;
  return (
    <ul className="outages-list">
      {outages.map((o) => (
        <li key={o.id} className="outage-item">
          <span className="outage-service">
            {o.type === "api" ? "API" : o.streamId}
          </span>
          <span className="outage-time">
            {formatDate(o.start)} · {formatTime(o.start)} – {formatTime(o.end)}
          </span>
          <span className="outage-duration">{formatUptime(o.durationMs)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [current, setCurrent] = useState<HistoryEntry | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkApiLoading, setCheckApiLoading] = useState(false);
  const [checkApiResult, setCheckApiResult] = useState<CheckApiResponse | null>(null);
  const [checkApiError, setCheckApiError] = useState<string | null>(null);

  const runCheckApi = async () => {
    setCheckApiLoading(true);
    setCheckApiResult(null);
    setCheckApiError(null);
    try {
      const result = await fetchCheckApi();
      setCheckApiResult(result);
    } catch (e) {
      setCheckApiError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckApiLoading(false);
    }
  };

  const load = async () => {
    setError(null);
    try {
      const [cur, h, hist] = await Promise.all([
        fetchStatusCurrent().catch(() => null),
        fetchHealth(),
        fetchStatusHistory().catch(() => []),
      ]);
      setCurrent(cur ?? null);
      setHealth(h);
      const raw = Array.isArray(hist) ? (hist as HistoryEntry[]) : [];
      setHistoryEntries(raw.slice(-MAX_CHART_POINTS));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const streamIds = current?.streams ? Object.keys(current.streams) : [];
  const outages = useMemo(() => computeOutages(historyEntries), [historyEntries]);

  if (loading) return <div className="app"><p className="muted">Loading…</p></div>;

  return (
    <div className="app">
      <header>
        <h1>Real-Debrid Uptime</h1>
        <p className="tagline">API &amp; streaming status</p>
        <p className="header-desc">
          Monitor Real-Debrid API health and CDN responsiveness. Data refreshes every 30s.{" "}
          <a href="https://real-debrid.com" target="_blank" rel="noopener noreferrer" className="header-link">
            real-debrid.com
          </a>
        </p>
      </header>
      {error && (
        <div className="card error-banner">
          {error}
        </div>
      )}
      <div className="grid">
        <CurrentStatus
          entry={current}
          onCheckApi={runCheckApi}
          checkApiLoading={checkApiLoading}
          checkApiResult={checkApiResult}
          checkApiError={checkApiError}
        />
        <Health health={health} />
      </div>
      <section className="card">
        <h2>Uptime</h2>
        <p className="meta">Last {UPTIME_HOURS} hours · green = operational, red = outage, grey = no data</p>
        <UptimeGrid entries={historyEntries} streamIds={streamIds} />
      </section>
      <section className="card">
        <h2>Latest outages</h2>
        <OutagesList outages={outages} />
      </section>
      <section className="card">
        <h2>History — TTFB by stream</h2>
        <HistoryChartAll entries={historyEntries} streamIds={streamIds} />
      </section>
    </div>
  );
}
