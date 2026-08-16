import { AppError } from "@/utils/AppError";
// Central error handler. Must be registered LAST in app.ts (after routes
// and notFoundHandler) so Express treats it as the error-handling middleware.
// Any `next(err)` call, or a thrown error inside an async route wrapped in
// asyncHandler, ends up here.
export function errorHandler(err, req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
next) {
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
//# sourceMappingURL=errorHandler.middleware.js.map