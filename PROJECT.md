# Real-Debrid Streaming Uptime Monitor

## Purpose

This project monitors **Real-Debrid API health** and **real streaming availability** (not just HTTP reachability).

It is designed to answer one question honestly:

> “Is Real-Debrid actually usable for streaming right now, and how has it behaved over time?”

No dashboards, no cloud, no databases.  
Local, inspectable, and graph-friendly.

---

## Core Features

1. **API Health Check**
   - Measures Real-Debrid API availability and latency.

2. **Streaming Health Checks**
   - Supports two stream types in `streams.json`:
     - **Hash (by hash):** Uses an existing cached item in your Real-Debrid account (by info hash). Find by hash → get links → unrestrict → HEAD for TTFB. No add/delete.
     - **Download (by URL):** Uses a Real-Debrid download URL (e.g. `https://real-debrid.com/d/ID`). Find in downloads list → HEAD the direct link.
   - Verifies actual CDN responsiveness (TTFB). No add/delete; no instant-availability check (that endpoint is disabled by Real-Debrid for many accounts).

3. **Scheduler**
   - Runs checks every **N seconds** (configurable).
   - Interval adjustable **without restart**.

4. **Persistent History**
   - Stores results locally (JSON or SQLite).
   - Append-only.
   - Keeps **last 7 days**, auto-prunes older data.

5. **HTTP API**
   - Exposes current status and historical data for graphs.

---

## Tech Constraints

- Node.js **18+**
- TypeScript preferred (JavaScript acceptable)
- No database server
- Optional frontend in `frontend/` (Vite + React + TypeScript); built output served from same origin
- No Docker
- No cloud services
- Use `fetch` (Node 18+)
- Must not crash on Real-Debrid failures
- `.env` loaded via `dotenv`; `npm run dev` compiles and runs the server with watch (listens on `PORT`).

---

## Environment Variables

Variables are read from `.env` (via `dotenv`). Copy `.env.example` to `.env` and set your API key.

```env
REAL_DEBRID_API_KEY=your_api_key_here
CHECK_INTERVAL_SECONDS=300
STORAGE_PATH=./data/history.json
PORT=3000
```

- `CHECK_INTERVAL_SECONDS` must be reloadable at runtime.
- Storage path must be created automatically if missing.

---

## Stream Configuration

Streams are defined in a local config file (e.g. `streams.json`):

```json
{
  "apiCheck": true,
  "streams": [
    { "id": "tv", "type": "hash", "hash": "40_CHAR_INFO_HASH" },
    { "id": "movie", "type": "hash", "hash": "40_CHAR_INFO_HASH" },
    { "id": "animation", "type": "hash", "hash": "40_CHAR_INFO_HASH" },
    { "id": "download1", "type": "download", "url": "https://real-debrid.com/d/DOWNLOAD_ID" }
  ]
}
```

- **`type: "hash"`** — `hash` is the info hash (40-char). The item must already be in your Real-Debrid cache list. Check runs: find by hash → get links → unrestrict first link → HEAD for TTFB.
- **`type: "download"`** — `url` is a Real-Debrid download URL (`https://real-debrid.com/d/ID`). Check runs: list downloads → find by ID → HEAD the direct `download` link for TTFB.

Each stream check:
1. Resolves a stream URL (from existing cache or download list; no add/delete).
2. Performs a `HEAD` request (fallback to `GET` with small `Range` header if needed).
3. Captures CDN hostname and latency (TTFB).

---

## Metrics to Record

### API Check
- `success` (boolean)
- `responseTimeMs`
- `httpStatus`
- `error` (if any)

### Per Stream
- `success`
- `apiResponseTimeMs`
- `ttfbMs`
- `httpStatus`
- `cdnHost`
- `errorType`  
  (`timeout | rate_limit | forbidden | server_error | network | unknown`)
- `failureStep` (optional, when failed)  
  (`cache_not_in_account | download_not_found | no_links | unrestrict_failed | cdn_head_failed`, etc.)

### Common
- `timestamp` (ISO 8601)

---

## Storage Format

Append-only records.

Example entry:

```json
{
  "timestamp": "2026-02-01T14:00:00Z",
  "api": {
    "success": true,
    "responseTimeMs": 180,
    "httpStatus": 200
  },
  "streams": {
    "tv": {
      "success": true,
      "ttfbMs": 420,
      "httpStatus": 200,
      "cdnHost": "rbx-cdn.real-debrid.com"
    },
    "movie": {
      "success": false,
      "httpStatus": 429,
      "errorType": "rate_limit"
    },
    "animation": {
      "success": true,
      "ttfbMs": 390,
      "httpStatus": 200
    }
  }
}
```

---

## HTTP API

### `GET /status/current`
Returns the **latest check only**.

### `GET /status/history`
Query parameters:
- `from` (ISO timestamp, optional)
- `to` (ISO timestamp, optional)
- `streamId` (`tv | movie | animation`, optional)

Response must be JSON and easy to graph.

### `GET /health`
Returns service self-health (uptime, last run, errors).

### `GET /cache`
Returns your Real-Debrid cache list (id, filename, hash, status, etc.) so you can pick hashes for `streams.json`. Requires API key from env.

### `GET /cache/instant?hash=XXX`
Debug: raw instant-availability API response for one hash. (That endpoint is disabled by Real-Debrid for many accounts; this is for inspection.)

---

## Operational Rules

- All external calls must have timeouts
- Failures must be isolated per check
- Never crash due to Real-Debrid issues
- Structured logging: one JSON line per check (`check_complete` with api, streams ok/fail, `streamReasons` and `streamRefs` when streams fail; `hint` on 401)
- Graceful shutdown (finish in-flight checks)

---

## Suggested Project Structure

```
src/
 ├─ index.ts            # bootstrap (dotenv, storage, scheduler, API server)
 ├─ scheduler.ts        # interval logic, check_complete logging
 ├─ rdClient.ts         # Real-Debrid API (user, cache list, downloads, unrestrict)
 ├─ streamChecker.ts   # stream by hash (existing cache) or by URL (download)
 ├─ storage.ts          # local persistence + 7-day prune
 ├─ config.ts           # env + streams.json reload
 └─ api/
     ├─ server.ts       # API routes + static frontend from frontend/dist
     └─ routes.ts
frontend/               # Vite + React + TypeScript UI
 ├─ src/
 │   ├─ App.tsx         # dashboard: current status, health, history chart
 │   ├─ api.ts          # fetch /status/current, /status/history, /health
 │   └─ ...
 ├─ index.html
 └─ package.json
data/
 └─ history.json
streams.json            # apiCheck + streams (type: hash | download)
.env                    # REAL_DEBRID_API_KEY, CHECK_INTERVAL_SECONDS, STORAGE_PATH, PORT
.env.example
README.md
PROJECT.md
```

---

## Frontend

A **dashboard** is included in `frontend/` (Vite + React + TypeScript). It shows current status (API + streams), service health (uptime, last run, last error), and a history chart (TTFB over time per stream). The Node server serves the built frontend from the same origin: after `npm run build:frontend`, open `http://localhost:PORT/` to see the UI; API routes remain under `/status`, `/health`, `/cache`.

**Build and run:** From the project root: `npm run build:all` (or `npm run build` then `npm run build:frontend`), then `npm start`. For dev: `npm run build:frontend` once, then `npm run dev`; refresh the browser to pick up frontend changes.

---

## Adding a frontend (custom)

The HTTP API is **graph-friendly**: `GET /status/current`, `GET /status/history` (with `from`, `to`, `streamId`), and `GET /health` return JSON you can use in a custom UI.

### What a frontend can do

- **Current status** — Call `GET /status/current` to show latest api + streams result (success/fail, TTFB, CDN host, errorType/failureStep).
- **History / graphs** — Call `GET /status/history?from=...&to=...` or `?streamId=tv` to get time-series data (timestamp, success, ttfbMs, httpStatus, etc.) and plot with any chart library (e.g. Chart.js, uPlot, Recharts).
- **Health** — Call `GET /health` for uptime, last run, last error.
- **Hash picker** — Call `GET /cache` to list cached items and let the user copy hashes into `streams.json` (or a future config API).

### How to add a frontend

**Option A: Same-origin static files**

- Build a static frontend (e.g. Vite, plain HTML/JS) into a folder like `public/` or `dist-ui/`.
- In the Node server, serve that folder at a path (e.g. `/` or `/app`) and keep API routes under `/status`, `/health`, `/cache`.
- The frontend uses relative URLs (`/status/current`, `/status/history?...`) so no CORS.

**Option B: Separate frontend app (different port)**

- Run the frontend dev server (e.g. Vite on port 5173) and the monitor API on `PORT` (e.g. 3000).
- The frontend fetches `http://localhost:3000/status/current` etc. You must **enable CORS** on the API (e.g. `Access-Control-Allow-Origin: http://localhost:5173` for dev).
- For production, either serve the built frontend from the Node server (Option A) or put both behind the same origin (reverse proxy).

**Option C: Reverse proxy**

- Run nginx (or similar) so that e.g. `https://monitor.local/` serves the frontend and `https://monitor.local/api/` proxies to the Node server. Frontend calls `/api/status/current`; no CORS, single origin.

### Security note

- The API has **no authentication**. Anyone who can reach the server can read status and history. Run the monitor locally or on a trusted network; if you expose it, add auth (e.g. API key header, reverse proxy with auth) or keep the frontend and API on a private host.

---

## Explicit Non-Goals

- No UI required (a dashboard is included in `frontend/`; see “Frontend”)
- No authentication on the API (by design for local/trusted use)
- No external monitoring services
- No assumptions about Real-Debrid SLA or guarantees

This tool exists to **observe reality**, not mask it.
