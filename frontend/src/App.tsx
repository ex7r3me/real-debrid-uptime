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

  if (loading) return <div className="app"><p className="muted">Loading…</p></div>;

  return (
    <div className="app">
      <header>
        <h1>Real-Debrid Uptime</h1>
        <p className="tagline">Streaming & API health</p>
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
        <h2>History — TTFB by stream</h2>
        <HistoryChartAll entries={historyEntries} streamIds={streamIds} />
      </section>
    </div>
  );
}
