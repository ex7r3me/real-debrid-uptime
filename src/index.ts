/**
 * Bootstrap: config, storage, scheduler, HTTP API. Graceful shutdown.
 */

import "dotenv/config";
import { ensureStoragePath } from "./storage.js";
import { start, stop } from "./scheduler.js";
import { startApiServer } from "./api/server.js";
import { getApiKey } from "./config.js";

function main(): void {
  ensureStoragePath();
  const token = getApiKey();
  if (!token) {
    console.error(
      JSON.stringify({ msg: "missing REAL_DEBRID_API_KEY", fatal: true })
    );
    process.exitCode = 1;
    return;
  }

  const server = startApiServer();
  start();

  const shutdown = () => {
    stop().then(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
