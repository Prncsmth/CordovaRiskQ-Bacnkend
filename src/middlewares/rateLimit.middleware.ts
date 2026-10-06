import { createHash } from "node:crypto";
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

// Second login limit, per email instead of per IP: the IP limit above alone
// lets someone spread password guesses for ONE account across many IPs.
// - Keyed by a SHA-256 of the normalized email (trimmed, lowercased -- the
//   same normalization the login schema applies), so limiter state never
//   holds the raw address, and never any password.
// - Counts only FAILED attempts (skipSuccessfulRequests): a successful login
//   isn't counted, so a user who logs in fine is never pushed toward it.
// - Applies the same way whether or not the account exists, with the same
//   message, so it reveals nothing about which emails are registered.
// - Generous enough (10 wrong passwords in 15 minutes) that a real user
//   fumbling their password isn't locked out, while capping a distributed
//   guessing run at ~40 tries an hour per account.
// Runs before validation, so a missing/non-string email falls back to the
// IP key rather than every such request sharing one bucket.
export const LOGIN_EMAIL_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 } as const;

export function loginEmailKey(req: Request): string {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof raw !== "string" || raw.trim() === "") {
        return `ip:${ipKeyGenerator(req.ip ?? "")}`;
    }
    const normalized = raw.trim().toLowerCase();
    return `email:${createHash("sha256").update(normalized).digest("hex")}`;
}

export const loginEmailLimiter = rateLimit({
    windowMs: LOGIN_EMAIL_LIMIT.windowMs,
    max: LOGIN_EMAIL_LIMIT.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: loginEmailKey,
    message: {
        success: false,
        message: "Too many failed login attempts for this email. Please try again in 15 minutes.",
    },
});

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
