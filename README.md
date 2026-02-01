# Real-Debrid Streaming Uptime Monitor

Monitors **Real-Debrid API health** and **real streaming availability** (CDN responsiveness). Answers: *“Is Real-Debrid actually usable for streaming right now, and how has it behaved over time?”*

Local, no cloud, no database. Stores history in JSON (or SQLite), keeps 7 days, exposes an HTTP API and optional dashboard.

## Requirements

- **Node.js 18+**
- **Real-Debrid API key** ([get one here](https://real-debrid.com/apitoken))

## Quick Start

1. **Install dependencies**

   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set your API key:

   ```env
   REAL_DEBRID_API_KEY=your_api_key_here
   CHECK_INTERVAL_SECONDS=300
   STORAGE_PATH=./data/history.json
   PORT=3000
   ```

3. **Configure streams** (optional)

   Edit `streams.json` to add streams to monitor. Use hashes from your cache or Real-Debrid download URLs. See [Stream configuration](#stream-configuration) below.

4. **Run**

   ```bash
   npm run dev
   ```

   Server runs at `http://localhost:3000`. The scheduler runs checks every `CHECK_INTERVAL_SECONDS` (default 300). History is written to `STORAGE_PATH`.

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Build + watch backend, run server (reloads on file change) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled server (`node dist/index.js`) |
| `npm run build:frontend` | Build React dashboard into `frontend/dist/` |
| `npm run build:all` | Build backend + frontend (serve dashboard from same origin) |

## Stream configuration

Streams are defined in `streams.json`:

- **`type: "hash"`** — Info hash (40 chars). The torrent must already be in your Real-Debrid cache. Check: find by hash → get links → unrestrict → HEAD for TTFB.
- **`type: "download"`** — Real-Debrid download URL (`https://real-debrid.com/d/ID`). Check: list downloads → find by ID → HEAD direct link for TTFB.

Use `GET /cache` (with API key in env) to list your cache and pick hashes. See `.env.example` and `PROJECT.md` for full options.

## HTTP API

| Endpoint | Description |
|----------|-------------|
| `GET /status/current` | Latest check result |
| `GET /status/history?from=...&to=...&streamId=...` | Historical data (for graphs) |
| `GET /health` | Service health (uptime, last run) |
| `GET /cache` | Your Real-Debrid cache list (for picking stream hashes) |

Built frontend is served from the same server when you run `npm run build:all` and then `npm run start`.

## CI/CD & Deploy

- **CI**: On every push and PR to `main`, GitHub Actions runs lint and full build.
- **CD**: On every push to `main`, the workflow deploys to a Hetzner server via SSH (pull → build → restart).

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for one-time Hetzner setup, systemd service, SSH key, and required GitHub secrets (`HETZNER_HOST`, `HETZNER_USER`, `HETZNER_SSH_KEY`, optional `HETZNER_DEPLOY_PATH`).

## License

MIT
