// Phase 32: import "./instrument" first
import "dotenv/config";
import { NODE_ENV, PORT, RUN_WORKERS_IN_API, TRUSTED_PROXY_CIDRS } from "./constants/env";
import { createApp } from "./app";
import { logger } from "./utils/logger";
import { connectDB, disconnectDB } from "./config/db";
import { cache } from "./utils/cache";

async function main() {
    // Phase 15: setCallRecorder(recordCall)
    await connectDB();
    let workers: typeof import("./worker.js") | null = null;
    if (RUN_WORKERS_IN_API !== "false") {
        // Dynamic on purpose: the workers start when ./worker is loaded. A static
        // `import … from "./worker"` would start them even with RUN_WORKERS_IN_API=false.
        workers = await import("./worker.js");
        await workers.initSchedulers();
        workers.startRelay();
        logger.info("[startup] in-process workers and schedulers initialized");
    } else {
        logger.info("[startup] RUN_WORKERS_IN_API=false — worker processing delegated to standalone worker");
    }

    if (NODE_ENV === "production" && !TRUSTED_PROXY_CIDRS.trim()) {
        logger.warn(
            "TRUSTED_PROXY_CIDRS is empty. If this server runs behind a load balancer or reverse proxy, " +
            "every client will share that proxy's IP and one rate-limit bucket. See .env.example."
        );
    }

    const app = createApp();

    const BACKEND_PORT = Number(PORT) || 5000;
    const server = app.listen(BACKEND_PORT, "0.0.0.0", () => {
        logger.info(`Server is listening to the port: ${BACKEND_PORT}`);
    });

    /*
      Orderly shutdown, in the order that loses nothing: stop accepting connections, let in-flight
      requests finish, then close the queue workers, the cache and the database. A deploy sends
      SIGTERM; exiting as soon as the workers closed could cut a request off mid-transaction.
     */
    const SHUTDOWN_GRACE_MS = 10_000;
    let shuttingDown = false;

    const shutdown = async (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[shutdown] ${reason} — closing`);

        // A client holding a keep-alive connection open shouldn't hold the deploy open with it.
        const forceExit = setTimeout(() => {
            logger.error("[shutdown] in-flight requests did not finish in time — exiting anyway");
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        forceExit.unref();

        try {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await workers?.closeWorkers();
            // Phase 21: await closePubSub()
            await cache.close();
            await disconnectDB();
            // Phase 32: await flushObservability()
            logger.info("[shutdown] complete");
            process.exit(0);
        } catch (error) {
            logger.error({ err: error }, "[shutdown] failed");
            process.exit(1);
        }
    };

    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));

    /*
      A rejection nobody handled would otherwise end the process with no context. Logged, then
      taken down the same orderly path.
     */
    process.on("unhandledRejection", (reason) => {
        logger.error({ reason }, "[fatal] unhandled promise rejection");
        void shutdown("unhandledRejection");
    });

    process.on("uncaughtException", (error) => {
        logger.error({ err: error }, "[fatal] uncaught exception");
        void shutdown("uncaughtException");
    });
}

main().catch((error) => {
    logger.error({ err: error }, "failed to start");
    process.exit(1);
});
