import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";

// Factory so every route family can define its own window/ceiling instead of
// sharing one global limit — e.g. login needs tight brute-force protection,
// while high-frequency endpoints like GPS pings need a much higher ceiling.
// Counts per client IP unless a keyGenerator is given.
function createRateLimiter(
    windowMs: number,
    max: number,
    message: string,
    keyGenerator?: (req: Request) => string
) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message },
        ...(keyGenerator ? { keyGenerator } : {}),
    });
}

// Per signed-in account rather than per IP: many phones can share one IP
// (school or barangay Wi-Fi, mobile carrier NAT), and one account shouldn't
// be able to dodge the limit by switching networks. Must run after
// authenticate; falls back to the IP if it somehow didn't.
function perUserKey(req: Request): string {
    const userId = (req as AuthenticatedRequest).userId;
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
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

// Every incident report pages all on-duty responders, so one account must
// not be able to flood them. 5 per 10 minutes is far above what a real
// reporter needs. SOS is deliberately NOT limited here -- it's already
// deduplicated to one active SOS per user (sosTrigger.ts), and an emergency
// must never be refused by a rate limit.
export const REPORT_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 } as const;

export const reportLimiter = createRateLimiter(
    REPORT_LIMIT.windowMs,
    REPORT_LIMIT.max,
    "You've sent several reports in a short time. Please wait a few minutes before sending another.",
    perUserKey
);

export const supportRequestLimiter = createRateLimiter(
    60 * 60 * 1000,
    10,
    "Too many support requests sent recently. Please wait a while before sending another."
);
