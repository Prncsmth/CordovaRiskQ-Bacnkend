// Custom error class for predictable, operational errors (e.g. bad input, not found).
// Throw this from services/controllers instead of a plain Error so the
// error handler middleware knows what HTTP status + message to send back.
export class AppError extends Error {
    statusCode;
    isOperational;
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Object.setPrototypeOf(this, AppError.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}
//# sourceMappingURL=AppError.js.map