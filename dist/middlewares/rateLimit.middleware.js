import rateLimit from "express-rate-limit";
// Factory so every route family can define its own window/ceiling instead of
// sharing one global limit — e.g. login needs tight brute-force protection,
// while high-frequency endpoints like GPS pings need a much higher ceiling.
function createRateLimiter(windowMs, max, message) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message },
    });
}
export const loginLimiter = createRateLimiter(60 * 1000, 5, "Too many login attempts. Please try again in a minute.");
export const registerLimiter = createRateLimiter(60 * 1000, 3, "Too many registration attempts. Please try again in a minute.");
//# sourceMappingURL=rateLimit.middleware.js.map