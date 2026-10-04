// Pure orchestration for "forgot password -> 6-digit code by email -> reset
// password". No Prisma, no email transport -- everything comes through
// `deps`, mirroring pendingRegistrationFlow.ts (whose OTP config and code
// generator it reuses), so this is unit-tested directly with in-memory
// fakes. See passwordReset.service.ts for the real wiring.
//
// Unlike registration, every outcome here is deliberately indistinguishable
// to the caller, so neither endpoint reveals whether an email has an
// account: forgot-password always returns the same message, and every
// failed reset (no request, wrong code, expired, attempts exhausted, no
// eligible account) returns the same error.
import { AppError } from "@/utils/AppError";
import { generateOtp, type OtpConfig } from "@/services/pendingRegistrationFlow";

export const FORGOT_PASSWORD_MESSAGE =
    "If an account exists, a password reset code has been sent to your email.";
export const INVALID_RESET_CODE_MESSAGE = "Invalid or expired code. Request a new one.";
export const PASSWORD_RESET_SUCCESS_MESSAGE = "Your password has been reset. You can now log in.";

export type PasswordResetRow = {
    email: string;
    otpHash: string;
    otpExpiresAt: Date;
    attempts: number;
};

export interface PasswordResetStore {
    findByEmail(email: string): Promise<PasswordResetRow | null>;
    upsert(row: PasswordResetRow): Promise<void>;
    incrementAttempts(email: string): Promise<void>;
    // Atomically deletes the row for this email. Returns false when it was
    // already gone -- i.e. another request consumed the code first.
    consume(email: string): Promise<boolean>;
}

export interface PasswordResetUserStore {
    // hasPassword is false for Google-only accounts: nothing to reset.
    findByEmail(email: string): Promise<{ id: string; hasPassword: boolean } | null>;
    updatePassword(userId: string, passwordHash: string): Promise<void>;
}

export interface PasswordResetDeps {
    resetStore: PasswordResetStore;
    userStore: PasswordResetUserStore;
    hash(value: string): Promise<string>;
    compareHash(value: string, hash: string): Promise<boolean>;
    // Must throw on failure. Never log the code.
    sendResetEmail(to: string, code: string, expiryMinutes: number): Promise<void>;
    // Runs right after a successful reset (production: disconnect the user's
    // live sockets). Must not throw.
    onPasswordChanged(userId: string): void;
    now(): Date;
    config: OtpConfig;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function genericResponse(config: OtpConfig): { message: string; resendCooldownSeconds: number } {
    // Same body for every case -- including the cooldown, which is the
    // configured value rather than anything account-specific.
    return {
        message: FORGOT_PASSWORD_MESSAGE,
        resendCooldownSeconds: Math.round(config.resendCooldownMs / 1000),
    };
}

export async function requestPasswordReset(
    input: { email: string },
    deps: PasswordResetDeps,
): Promise<{ message: string; resendCooldownSeconds: number }> {
    const email = normalizeEmail(input.email);
    const response = genericResponse(deps.config);

    const user = await deps.userStore.findByEmail(email);
    // Unknown email or Google-only account: send nothing, say the same thing.
    if (!user || !user.hasPassword) return response;

    // Server-side cooldown, enforced silently: a 429 here would only ever
    // happen for real accounts and so would reveal that the email exists.
    const existing = await deps.resetStore.findByEmail(email);
    if (existing) {
        const sentAt = existing.otpExpiresAt.getTime() - deps.config.expiryMs;
        if (deps.now().getTime() - sentAt < deps.config.resendCooldownMs) return response;
    }

    const code = generateOtp();
    const otpHash = await deps.hash(code);
    const otpExpiresAt = new Date(deps.now().getTime() + deps.config.expiryMs);

    // Send BEFORE persisting (same as registration): a failed send leaves no
    // fresh row and no cooldown behind, and a previous working code intact.
    try {
        await deps.sendResetEmail(email, code, Math.round(deps.config.expiryMs / 60_000));
    } catch {
        // Swallowed on purpose: a 502 would only ever happen for real
        // accounts. The email service has already logged why (never the
        // code); the user can simply ask again.
        return response;
    }

    await deps.resetStore.upsert({ email, otpHash, otpExpiresAt, attempts: 0 });
    return response;
}

// What POST /forgot-password actually calls. Answers immediately with the
// generic response and runs requestPasswordReset (account lookup, cooldown,
// email, saving the code) in the background -- so a real account, an
// unknown email and a Google-only account all take the same time to answer.
// Awaiting the email for real accounts only made response time reveal
// whether an account exists.
//
// requestPasswordReset is unchanged, so the code, its single use and the
// cooldown behave exactly as before: the cooldown still applies (silently),
// and a failed send still leaves no new code behind. `schedule` is
// runInBackground in production, which logs a failed task by label only --
// never the email or the code.
export function startPasswordResetRequest(
    input: { email: string },
    deps: PasswordResetDeps,
    schedule: (label: string, task: () => Promise<unknown>) => void,
): { message: string; resendCooldownSeconds: number } {
    schedule("password reset request", () => requestPasswordReset(input, deps));
    return genericResponse(deps.config);
}

export async function resetPassword(
    input: { email: string; code: string; newPassword: string },
    deps: PasswordResetDeps,
): Promise<{ message: string }> {
    const email = normalizeEmail(input.email);
    const invalid = () => new AppError(INVALID_RESET_CODE_MESSAGE, 400);

    const row = await deps.resetStore.findByEmail(email);
    if (!row) throw invalid();

    if (row.otpExpiresAt.getTime() < deps.now().getTime()) throw invalid();

    if (row.attempts >= deps.config.maxAttempts) {
        await deps.resetStore.consume(email);
        throw invalid();
    }

    if (!(await deps.compareHash(input.code, row.otpHash))) {
        if (row.attempts + 1 >= deps.config.maxAttempts) {
            // Out of attempts: the code is dead, so delete it outright.
            await deps.resetStore.consume(email);
        } else {
            await deps.resetStore.incrementAttempts(email);
        }
        throw invalid();
    }

    // Single use: consume before changing anything, so two simultaneous
    // requests with the same correct code can't both succeed.
    if (!(await deps.resetStore.consume(email))) throw invalid();

    // Rows are only ever created for eligible accounts, but re-check: never
    // create an account, and never give a Google-only account a password.
    const user = await deps.userStore.findByEmail(email);
    if (!user || !user.hasPassword) throw invalid();

    await deps.userStore.updatePassword(user.id, await deps.hash(input.newPassword));
    deps.onPasswordChanged(user.id);
    return { message: PASSWORD_RESET_SUCCESS_MESSAGE };
}
