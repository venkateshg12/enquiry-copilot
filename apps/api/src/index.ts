// Phase 32: import "./instrument" first
import "dotenv/config";
import { NODE_ENV, PORT, RUN_WORKERS_IN_API } from "./constants/env";
import { createApp } from "./app";
import { closeWorkers, initSchedulers, startRelay } from "./worker";

async function main() {
    // Phase 15: setCallRecorder(recordCall)
    // Phase 03: await connectDB()
    if (RUN_WORKERS_IN_API !== "false") {
        await initSchedulers();
        startRelay();
        console.log("[startup] in-process workers, schedulers, and outbox relay initialized"); // Phase 02: logger
    } else {
        console.log("[startup] RUN_WORKERS_IN_API=false — worker processing delegated to standalone worker"); // Phase 02: logger
    }

    if (NODE_ENV === "production") {
        // Phase 06: warn when TRUSTED_PROXY_CIDRS is empty behind a proxy.
    }

    const app = createApp();

    const BACKEND_PORT = Number(PORT) || 5000;
    const server = app.listen(BACKEND_PORT, "0.0.0.0", () => {
        console.log(`Server is listening to the port: ${BACKEND_PORT}`); // Phase 02: logger
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
        console.log(`[shutdown] ${reason} — closing`); // Phase 02: logger

        // A client holding a keep-alive connection open shouldn't hold the deploy open with it.
        const forceExit = setTimeout(() => {
            console.error("[shutdown] in-flight requests did not finish in time — exiting anyway"); // Phase 02: logger
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        forceExit.unref();

        try {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            if (RUN_WORKERS_IN_API !== "false") {
                await closeWorkers();
            }
            // Phase 21: await closePubSub()
            // Phase 07: await cache.close()
            // Phase 03: await disconnectDB()
            // Phase 32: await flushObservability()
            console.log("[shutdown] complete"); // Phase 02: logger
            process.exit(0);
        } catch (error) {
            console.error("[shutdown] failed", error); // Phase 02: logger
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
        console.error("[fatal] unhandled promise rejection", reason); // Phase 02: logger
        void shutdown("unhandledRejection");
    });

    process.on("uncaughtException", (error) => {
        console.error("[fatal] uncaught exception", error); // Phase 02: logger
        void shutdown("uncaughtException");
    });
}

main().catch((error) => {
    console.error("failed to start", error); // Phase 02: logger
    process.exit(1);
});
