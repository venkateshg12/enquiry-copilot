import "dotenv/config";
import http from "node:http";
import { connectDB, disconnectDB, isDbHealthy } from "./config/db";
import { emailWorker } from "./jobs/workers/email.worker";
import { maintenanceWorker } from "./jobs/workers/maintenance.worker";
import { maintenanceQueue } from "./jobs/queues/maintenance.queue";
import { JOB_NAMES } from "./constants/queue";
import { PORT, WORKER_PORT } from "./constants/env";
import { logger } from "./utils/logger";
import { redisConnection } from "./jobs/redis/connection";

/*
  The queue workers' entry point. Phase 13 adds the outbox relay, Phase 21 the pipeline worker,
  Phase 24 the send-reply worker. index.ts imports closeWorkers/initSchedulers when it runs them
  in-process (RUN_WORKERS_IN_API=true).
 */

// Phase 13: export { startRelay, stopRelay } from the outbox relay.
export const startRelay = () => {};

export const initSchedulers = async () => {
  try {
    // PostgreSQL has no TTL indexes: hourly removal of expired sessions and links (more rows in later phases).
    await maintenanceQueue.upsertJobScheduler(
      "purge-expired",
      { pattern: "15 * * * *" },
      { name: JOB_NAMES.MAINTENANCE.PURGE_EXPIRED }
    );
    // Phase 28: retention sweep · Phase 25: Gmail poll scheduler
    logger.info("Maintenance job schedulers initialized (purge-expired)");
  } catch (err) {
    logger.error({ err }, "Failed to initialize maintenance job scheduler");
  }
};

/** Stops queue workers from taking new jobs and waits for the ones in flight. */
export const closeWorkers = async () => {
  // Phase 13: await stopRelay()
  await Promise.all([emailWorker.close(), maintenanceWorker.close()]);
  // Phase 21: await closePubSub() · Phase 32: await flushObservability()
};

/**
 * Creates a lightweight HTTP server for container health checks (Render, Cloud Run): they require
 * the process to listen on $PORT (defaults to 8080).
 */
export function createHealthServer(
  port: number = Number(PORT || WORKER_PORT) || 8080
): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health" || url.pathname === "/healthz" || url.pathname === "/") {
      try {
        const dbOk = await isDbHealthy();
        let redisOk = false;
        try {
          const pong = await redisConnection.ping();
          redisOk = pong === "PONG";
        } catch {
          redisOk = false;
        }

        const workersStatus = {
          email: emailWorker.isRunning(),
          maintenance: maintenanceWorker.isRunning(),
        };
        const allWorkersRunning = Object.values(workersStatus).every(Boolean);
        const healthy = dbOk && redisOk && allWorkersRunning;

        const body = JSON.stringify({
          status: healthy ? "ok" : "degraded",
          service: "enquiry-worker",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          database: dbOk ? "connected" : "disconnected",
          redis: redisOk ? "connected" : "disconnected",
          workers: workersStatus,
        });

        res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
        res.end(body);
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: err.message }));
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Worker health check server listening on 0.0.0.0:${port}`);
  });

  return server;
}

let healthServer: http.Server | null = null;

async function startWorker() {
  // Phase 15: setCallRecorder(recordCall)
  await connectDB();
  await initSchedulers();
  startRelay();
  healthServer = createHealthServer();
  logger.info("Background worker process initialized (email, maintenance)");
}

/*
  This module is imported by the API (index.ts) so one process can serve requests and run jobs, and
  is also started on its own via `pnpm worker`. Only the standalone process connects the database
  and owns the signal handlers: registering them here unconditionally meant that in the API process
  a SIGTERM exited as soon as the workers closed, killing in-flight HTTP requests, possibly
  mid-transaction. When imported, index.ts drives shutdown and calls closeWorkers() itself.
 */
if (require.main === module) {
  startWorker().catch((err) => {
    logger.error({ err }, "Failed to start worker process");
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Closing background workers gracefully...`);
    if (healthServer) {
      healthServer.close();
    }
    const forceExit = setTimeout(() => {
      logger.error("Worker graceful shutdown timed out after 10s, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await closeWorkers();
      await disconnectDB();
      logger.info("Background worker shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
