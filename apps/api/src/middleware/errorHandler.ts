import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { fail } from "../utils/api";
import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
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
    // Phase 04: clear the auth cookies when the failing request was the refresh path.
    if (error instanceof AppError) {
        if (error.statusCode >= 500) {
            console.error(error.message, error); // Phase 02: logger
            // Phase 32: Sentry.captureException(error)
        } else {
            // Phase 02: logger.debug({ code, status }, message)
        }
        return res.status(error.statusCode).json(fail(error.message, error.errorCode ?? "APP_ERROR"));
    }
    console.error("unhandled error", error); // Phase 02: logger
    // Phase 32: Sentry.captureException(error)

    return res.status(INTERNAL_SERVER_ERROR).json(fail("Internal Server Error", "INTERNAL_SERVER_ERROR"));
}
