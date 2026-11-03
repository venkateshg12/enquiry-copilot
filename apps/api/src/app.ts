import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CORS_ORIGIN, NODE_ENV } from "./constants/env";
import { ok } from "./utils/api";
import { notFound } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";

/*
  Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
  the integration tests (Phase 31) call it directly with Supertest.
 */
export const createApp = () => {
    const app = express();

    // First, so even a helmet or CORS rejection carries an id.
    app.use(requestId);
    // Phase 06: trust proxy + limiters.
    app.use(
        helmet({
            crossOriginResourcePolicy: { policy: "cross-origin" },
            hsts: NODE_ENV === "production" ? undefined : false,
        })
    );

    const corsOrigin = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
    app.use(cors({ origin: corsOrigin, credentials: true }));
    // Phase 13: the public intake route is mounted BEFORE this cors() with its own per-form CORS.

    app.use(express.json({ limit: "100kb" })); // messages are ≤ 5,000 chars; nothing here is big
    app.use(cookieParser());

    // Health first, so routers that call router.use(authenticate) can never shadow it.
    app.get("/health", (_req, res) => {
        // Phase 03: database. Phases 06–07: redis, cache.
        res.status(200).json(ok({ status: "ok" }));
    });

    // Routes are registered here, phase by phase.

    app.use(notFound);
    app.use(errorHandler);
    return app;
};
