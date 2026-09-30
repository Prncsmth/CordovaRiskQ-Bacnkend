import { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/AppError";

// Fixed messages for express.json()'s (body-parser's) client errors. The
// parser's own message isn't reused: it can quote part of the raw body.
const BODY_PARSER_MESSAGES: Record<string, string> = {
    "entity.parse.failed": "Invalid JSON in request body",
    "entity.too.large": "Request body is too large",
};

// body-parser raises http-errors with `expose: true` and a 4xx status when
// the *client* sent a bad body (e.g. malformed JSON from a mis-quoted curl
// command) -- a client mistake, not an unexpected server failure.
function bodyParserClientError(err: unknown): { statusCode: number; message: string } | null {
    const e = err as { type?: unknown; status?: unknown; expose?: unknown } | null;
    if (!e || e.expose !== true || typeof e.status !== "number" || e.status < 400 || e.status >= 500) {
        return null;
    }
    const message = typeof e.type === "string" ? BODY_PARSER_MESSAGES[e.type] : undefined;
    return { statusCode: e.status, message: message ?? "Invalid request" };
}

// Central error handler. Must be registered LAST in app.ts (after routes
// and notFoundHandler) so Express treats it as the error-handling middleware.
// Any `next(err)` call, or a thrown error inside an async route wrapped in
// asyncHandler, ends up here.
export function errorHandler(
    err: Error | AppError,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction
) {
    const clientError = err instanceof AppError ? null : bodyParserClientError(err);
    if (clientError) {
        res.status(clientError.statusCode).json({ success: false, message: clientError.message });
        return;
    }

    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err instanceof AppError ? err.message : "Internal server error";

    if (!(err instanceof AppError)) {
        // Unexpected error — log full details for debugging.
        console.error("Unexpected error:", err);
    }

    res.status(statusCode).json({
        success: false,
        message,
    });
}
