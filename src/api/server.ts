/**
 * HTTP server: API routes + static frontend from frontend/dist.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  handleStatusCurrent,
  handleStatusHistory,
  handleHealth,
  handleCacheList,
  handleCacheInstant,
  handleCheckApi,
} from "./routes.js";
import { getPort, getFrontendDistPath } from "../config.js";

const MIMES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export function createApiServer(): ReturnType<typeof createServer> {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    const send = (status: number, body: string, contentType = "application/json") => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    };

    try {
      if (method === "POST" && path === "/status/check") {
        const result = await handleCheckApi();
        send(result.status, result.body);
        return;
      }
      if (method !== "GET") {
        send(405, JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }

      if (path === "/status/current") {
        const { status, body } = handleStatusCurrent();
        send(status, body);
        return;
      }
      if (path === "/status/history") {
        const from = url.searchParams.get("from") ?? undefined;
        const to = url.searchParams.get("to") ?? undefined;
        const streamId = url.searchParams.get("streamId") ?? undefined;
        const { status, body } = handleStatusHistory(from, to, streamId);
        send(status, body);
        return;
      }
      if (path === "/health") {
        const { status, body } = handleHealth();
        send(status, body);
        return;
      }
      if (path === "/cache") {
        const result = await handleCacheList();
        send(result.status, result.body);
        return;
      }
      if (path === "/cache/instant") {
        const hash = url.searchParams.get("hash") ?? "";
        const result = await handleCacheInstant(hash);
        send(result.status, result.body);
        return;
      }

      const frontendDir = getFrontendDistPath();
      if (!existsSync(frontendDir)) {
        send(404, JSON.stringify({ error: "Not Found" }));
        return;
      }
      const safePath = normalize(path).replace(/^(\.\.(\/|\\|$))+/, "");
      const relativePath = safePath === "/" ? "index.html" : safePath.slice(1);
      const filePath = join(frontendDir, relativePath);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath);
          const dot = relativePath.lastIndexOf(".");
          const ext = dot >= 0 ? relativePath.slice(dot) : "";
          const contentType = MIMES[ext as keyof typeof MIMES] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          res.end(content);
          return;
        } catch {
          // fall through to index.html
        }
      }
      const indexPath = join(frontendDir, "index.html");
      if (existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(readFileSync(indexPath));
        return;
      }
      send(404, JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      send(500, JSON.stringify({ error: "Internal Server Error" }));
    }
  });
}

export function startApiServer(): ReturnType<typeof createServer> {
  const server = createApiServer();
  const port = getPort();
  server.listen(port, () => {
    console.log(JSON.stringify({ msg: "api_listen", port }));
  });
  return server;
}
