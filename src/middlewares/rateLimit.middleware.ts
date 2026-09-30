import rateLimit from "express-rate-limit";

// Factory so every route family can define its own window/ceiling instead of
// sharing one global limit — e.g. login needs tight brute-force protection,
// while high-frequency endpoints like GPS pings need a much higher ceiling.
function createRateLimiter(windowMs: number, max: number, message: string) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message },
    });
}

export const loginLimiter = createRateLimiter(
    60 * 1000,
    5,
    "Too many login attempts. Please try again in a minute."
);

export const registerLimiter = createRateLimiter(
    60 * 1000,
    3,
    "Too many registration attempts. Please try again in a minute."
);

// change-password re-verifies the caller's current password via bcrypt.compare
// with no other limit on that route -- without this, a stolen JWT (without
// the actual password) could be used to brute-force it and take over the
// account permanently. Same category as loginLimiter, just a longer window
// since this is an authenticated, lower-frequency action.
export const changePasswordLimiter = createRateLimiter(
    60 * 60 * 1000,
    5,
    "Too many password change attempts. Please try again later."
);

export const requestOtpLimiter = createRateLimiter(
    5 * 60 * 1000,
    5,
    "Too many verification code requests. Please try again in a few minutes."
);

export const verifyOtpLimiter = createRateLimiter(
    5 * 60 * 1000,
    10,
    "Too many attempts. Please try again in a few minutes."
);

export const supportRequestLimiter = createRateLimiter(
    60 * 60 * 1000,
    10,
    "Too many support requests sent recently. Please wait a while before sending another."
);
