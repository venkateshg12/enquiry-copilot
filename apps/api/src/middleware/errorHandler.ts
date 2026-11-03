import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { fail } from "../utils/api";
import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { logger } from "../utils/logger";
import { clearAuthCookies, REFRESH_PATH } from "../utils/auth";
import z from "zod";

/*
  Validation failures stay inside the envelope like every other error, with the field path on each
  entry. e-commerce answered `{ errors }` here, the one response shape outside the envelope.
 */
const handleZodError = (res: Response, error: z.ZodError) =>
    res.status(BAD_REQUEST).json({
        status: "error",
        data: null,
        errors: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: appErrorCode.ValidationError,
        })),
    });

export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
) {
    if (error instanceof z.ZodError) {
        return handleZodError(res, error);
    }
    // express.json() rejects a malformed body with a SyntaxError typed "entity.parse.failed".
    if ((error as { type?: string })?.type === "entity.parse.failed") {
        return res.status(BAD_REQUEST).json(fail("Malformed JSON body", appErrorCode.ValidationError));
    }
    if ((error as { type?: string })?.type === "entity.too.large") {
        return res.status(413).json(fail("Request body too large", appErrorCode.ValidationError));
    }
    if (_req.path === REFRESH_PATH) {
        clearAuthCookies(res);
    }
    if (error instanceof AppError) {
        if (error.statusCode >= 500) {
            logger.error({ err: error }, error.message);
            // Phase 32: Sentry.captureException(error)
        } else {
            logger.debug({ code: error.errorCode, status: error.statusCode }, error.message);
        }
        return res.status(error.statusCode).json(fail(error.message, error.errorCode ?? "APP_ERROR"));
    }
    logger.error({ err: error }, "unhandled error");
    // Phase 32: Sentry.captureException(error)

    return res.status(INTERNAL_SERVER_ERROR).json(fail("Internal Server Error", "INTERNAL_SERVER_ERROR"));
}
