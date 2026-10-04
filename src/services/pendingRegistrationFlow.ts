// Pure orchestration for the "request-otp -> verify-otp -> create User"
// registration flow: our own email + password accounts, verified with a
// 6-digit code emailed over SMTP. No Prisma, no email transport --
// everything comes through `deps`, mirroring src/services/sosTrigger.ts's
// split from sos.service.ts, so this is unit-tested directly with in-memory
// fakes. See pendingRegistration.service.ts for the real wiring.
import crypto from "node:crypto";
import { AppError } from "@/utils/AppError";

export type OtpConfig = {
    expiryMs: number;
    resendCooldownMs: number;
    maxAttempts: number;
};

// Defaults match the original OTP flow. Invalid/missing values fall back to
// them instead of silently weakening the limits (e.g. OTP_MAX_ATTEMPTS=0).
export const DEFAULT_OTP_CONFIG: OtpConfig = {
    expiryMs: 10 * 60 * 1000,
    resendCooldownMs: 60 * 1000,
    maxAttempts: 5,
};

function positiveInt(value: string | undefined): number | null {
    if (value === undefined || value.trim() === "") return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

export function loadOtpConfig(env: Record<string, string | undefined> = process.env): OtpConfig {
    const minutes = positiveInt(env.OTP_EXPIRY_MINUTES);
    const cooldown = positiveInt(env.OTP_RESEND_COOLDOWN_SECONDS);
    const attempts = positiveInt(env.OTP_MAX_ATTEMPTS);
    return {
        expiryMs: minutes ? minutes * 60 * 1000 : DEFAULT_OTP_CONFIG.expiryMs,
        resendCooldownMs: cooldown ? cooldown * 1000 : DEFAULT_OTP_CONFIG.resendCooldownMs,
        maxAttempts: attempts ?? DEFAULT_OTP_CONFIG.maxAttempts,
    };
}

export type PendingRegistrationRow = {
    email: string;
    name: string | null;
    passwordHash: string;
    otpHash: string;
    otpExpiresAt: Date;
    attempts: number;
};

export type CreatedUser = {
    id: string;
    email: string;
    name: string | null;
    role: string;
    isOnDuty: boolean;
    createdAt: Date;
};

export interface PendingRegistrationStore {
    findByEmail(email: string): Promise<PendingRegistrationRow | null>;
    upsert(row: PendingRegistrationRow): Promise<void>;
    incrementAttempts(email: string): Promise<void>;
    // Atomically deletes the row for this email. Returns false when it was
    // already gone -- i.e. another request consumed the code first.
    consume(email: string): Promise<boolean>;
}

export interface UserStore {
    findByEmail(email: string): Promise<{ id: string } | null>;
    create(data: { email: string; name: string | null; passwordHash: string }): Promise<CreatedUser>;
}

export interface RegistrationOtpDeps {
    pendingStore: PendingRegistrationStore;
    userStore: UserStore;
    hash(value: string): Promise<string>;
    compareHash(value: string, hash: string): Promise<boolean>;
    // Must throw on failure. Never log the code.
    sendOtpEmail(to: string, code: string, expiryMinutes: number): Promise<void>;
    now(): Date;
    config: OtpConfig;
    // Fires only on real account creation (verifyRegistrationOtp's success
    // path) -- lets the real wiring emit the same admin activity event the
    // app has always emitted on sign-up, without this pure module knowing
    // anything about realtime/emit.ts.
    onUserCreated(user: CreatedUser): void;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

// Also used by passwordResetFlow.ts, so both flows share one generator.
export function generateOtp(): string {
    // Cryptographically secure; 0..999_999 padded, so "000123" is possible.
    // randomInt's upper bound is exclusive.
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Server-side cooldown -- the app's countdown is only a convenience.
function assertCooldownElapsed(pending: PendingRegistrationRow, deps: RegistrationOtpDeps): void {
    const sentAt = pending.otpExpiresAt.getTime() - deps.config.expiryMs;
    if (deps.now().getTime() - sentAt < deps.config.resendCooldownMs) {
        throw new AppError("Please wait before requesting another code.", 429);
    }
}

// Generates a fresh code, emails it, and only then stores it (replacing any
// previous code and resetting attempts). Send BEFORE persisting: if sending
// throws, no fresh row (and so no new cooldown) is left behind for a code
// that never arrived, and a resend's previous working code stays intact.
// Not caught -- request/resend must never look successful when the email
// didn't go out.
async function issueCode(
    row: { email: string; name: string | null; passwordHash: string },
    deps: RegistrationOtpDeps,
): Promise<{ resendCooldownSeconds: number }> {
    const code = generateOtp();
    const otpHash = await deps.hash(code);
    const otpExpiresAt = new Date(deps.now().getTime() + deps.config.expiryMs);

    await deps.sendOtpEmail(row.email, code, Math.round(deps.config.expiryMs / 60_000));

    await deps.pendingStore.upsert({ ...row, otpHash, otpExpiresAt, attempts: 0 });

    // Never the code itself -- only the email carries it.
    return { resendCooldownSeconds: Math.round(deps.config.resendCooldownMs / 1000) };
}

export async function requestRegistrationOtp(
    input: { name?: string; email: string; password: string },
    deps: RegistrationOtpDeps,
): Promise<{ resendCooldownSeconds: number }> {
    const email = normalizeEmail(input.email);

    if (await deps.userStore.findByEmail(email)) {
        throw new AppError("Email already registered", 409);
    }

    const existingPending = await deps.pendingStore.findByEmail(email);
    if (existingPending) assertCooldownElapsed(existingPending, deps);

    const passwordHash = await deps.hash(input.password);
    return issueCode({ email, name: input.name?.trim() || null, passwordHash }, deps);
}

// Resend needs only the email: the password was already bcrypt-hashed and
// stored by requestRegistrationOtp, so the app never has to keep or re-send
// it. Each resend replaces the previous code and resets attempts.
export async function resendRegistrationOtp(
    input: { email: string },
    deps: RegistrationOtpDeps,
): Promise<{ resendCooldownSeconds: number }> {
    const email = normalizeEmail(input.email);

    const pending = await deps.pendingStore.findByEmail(email);
    if (!pending) {
        throw new AppError("No pending registration for this email. Please register again.", 404);
    }
    if (await deps.userStore.findByEmail(email)) {
        throw new AppError("Email already registered", 409);
    }
    assertCooldownElapsed(pending, deps);

    return issueCode({ email, name: pending.name, passwordHash: pending.passwordHash }, deps);
}

export async function verifyRegistrationOtp(
    input: { email: string; code: string },
    deps: RegistrationOtpDeps,
): Promise<CreatedUser> {
    const email = normalizeEmail(input.email);

    const pending = await deps.pendingStore.findByEmail(email);
    if (!pending) {
        throw new AppError("No pending registration for this email", 404);
    }

    if (pending.otpExpiresAt.getTime() < deps.now().getTime()) {
        throw new AppError("Code has expired. Request a new one.", 410);
    }

    if (pending.attempts >= deps.config.maxAttempts) {
        throw new AppError("Too many attempts. Request a new code.", 429);
    }

    const matches = await deps.compareHash(input.code, pending.otpHash);
    if (!matches) {
        await deps.pendingStore.incrementAttempts(email);
        if (pending.attempts + 1 >= deps.config.maxAttempts) {
            throw new AppError("Too many attempts. Request a new code.", 429);
        }
        throw new AppError("Incorrect code", 401);
    }

    // Single use: consume before creating anything, so two simultaneous
    // requests with the same correct code can't both succeed.
    if (!(await deps.pendingStore.consume(email))) {
        throw new AppError("No pending registration for this email", 404);
    }

    // The email could have been registered another way (e.g. Google) since
    // the code was requested.
    if (await deps.userStore.findByEmail(email)) {
        throw new AppError("Email already registered", 409);
    }

    const user = await deps.userStore.create({
        email,
        name: pending.name,
        passwordHash: pending.passwordHash,
    });
    deps.onUserCreated(user);
    return user;
}
