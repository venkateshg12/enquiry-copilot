import pino from "pino";
import type { DestinationStream } from "pino";
import { LOG_LEVEL, NODE_ENV, SERVICE_NAME } from "../constants/env";
import { getRequestContext } from "./requestContext";

const both = (...keys: string[]) => keys.flatMap((key) => [key, `*.${key}`]);

/*
  Keys whose values never reach a log line. Paths, not a recursive scan: pino compiles them once.
  `*.x` covers one level of nesting, which is where request bodies and job data put these fields.
  The rule is still "log ids, not content"; this list is the backstop for code that forgets.
 */
const REDACT_PATHS = [
    ...both("password", "currentPassword", "newPassword", "token", "accessToken", "refreshToken",
            "verificationToken", "resetToken", "apiKey", "secret", "authorization", "cookie"),
    "headers.authorization", "headers.cookie",
    // Customer messages and contacts (spec §8). They live in PostgreSQL behind auth and tenancy.
    ...both("body", "subject", "text", "html", "snippet", "draft", "draftText", "finalText", "rawOutput"),
    ...both("fromName", "fromContact", "email", "phone", "customer_name", "to", "from", "replyTo"),
    // Per-business Gmail credentials (Phase 25).
    ...both("sealedRefreshToken", "code"),
];

// pino-pretty is a devDependency, so a container started with NODE_ENV=development (the compose
// stack) does not have it. Fall back to plain JSON lines instead of crashing at import time.
const canPrettyPrint = (): boolean => {
    try {
        require.resolve("pino-pretty");
        return true;
    } catch {
        return false;
    }
};

// Swappable sink for the non-pretty branch, so a test can capture what the real `logger` prints
// without every module importing a different instance.
let current: DestinationStream = pino.destination(1); // stdout
const sink: DestinationStream = { write: (line: string) => current.write(line) };

/** Tests only: send every log line to `stream` (e.g. Phase 31's logCapture). */
export const setLogDestination = (stream: DestinationStream) => {
    current = stream;
};

const options: pino.LoggerOptions = {
    level: LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // Every line carries the request (or job) it belongs to, and who was acting.
    mixin() {
        const context = getRequestContext();
        return context ? { ...context } : {};
    },
    base: { service: SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger =
    NODE_ENV === "development" && canPrettyPrint()
        ? pino({
              ...options,
              transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
          })
        : pino(options, sink);
