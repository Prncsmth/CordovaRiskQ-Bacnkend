// Pure orchestration for the "request-otp -> verify-otp -> create User"
// registration flow. No Prisma, no Resend -- everything comes through
// `deps`, mirroring src/services/sosTrigger.ts's split from sos.service.ts,
// so this is unit-tested directly with in-memory fakes. See
// pendingRegistration.service.ts for the real Prisma/Resend wiring.
import crypto from "node:crypto";
import { AppError } from "@/utils/AppError";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

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
    delete(email: string): Promise<void>;
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
    sendOtpEmail(to: string, code: string): Promise<void>;
    now(): Date;
    // Fires only on real account creation (verifyRegistrationOtp's success
    // path) -- lets the real wiring emit the same admin activity event
    // authService.register already emits today, without this pure module
    // knowing anything about realtime/emit.ts.
    onUserCreated(user: CreatedUser): void;
}

function generateOtp(): string {
    // 0..999_999 inclusive of leading zeros -- randomInt's upper bound is
    // exclusive, so 1_000_000 gives a uniform 6-digit space including "000000".
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function requestRegistrationOtp(
    input: { name?: string; email: string; password: string },
    deps: RegistrationOtpDeps,
): Promise<void> {
    const email = input.email.trim().toLowerCase();

    const existingUser = await deps.userStore.findByEmail(email);
    if (existingUser) {
        throw new AppError("Email already registered", 409);
    }

    const existingPending = await deps.pendingStore.findByEmail(email);
    if (existingPending) {
        const sentAt = existingPending.otpExpiresAt.getTime() - OTP_EXPIRY_MS;
        const elapsed = deps.now().getTime() - sentAt;
        if (elapsed < RESEND_COOLDOWN_MS) {
            throw new AppError("Please wait before requesting another code.", 429);
        }
    }

    const passwordHash = await deps.hash(input.password);
    const code = generateOtp();
    const otpHash = await deps.hash(code);
    const otpExpiresAt = new Date(deps.now().getTime() + OTP_EXPIRY_MS);

    // Send BEFORE persisting: if sendOtpEmail throws, we must not leave a
    // pending row (and thus a fresh otpExpiresAt / resend cooldown) behind
    // for a code that was never actually delivered. Not caught here -- a
    // send failure propagates to the caller (see Global Constraints:
    // request-otp must never look like it succeeded when the email never
    // went out).
    await deps.sendOtpEmail(email, code);

    await deps.pendingStore.upsert({
        email,
        name: input.name?.trim() || null,
        passwordHash,
        otpHash,
        otpExpiresAt,
        attempts: 0,
    });
}

export async function verifyRegistrationOtp(
    input: { email: string; code: string },
    deps: RegistrationOtpDeps,
): Promise<CreatedUser> {
    const email = input.email.trim().toLowerCase();

    const pending = await deps.pendingStore.findByEmail(email);
    if (!pending) {
        throw new AppError("No pending registration for this email", 404);
    }

    if (pending.otpExpiresAt.getTime() < deps.now().getTime()) {
        throw new AppError("Code has expired. Request a new one.", 410);
    }

    if (pending.attempts >= MAX_ATTEMPTS) {
        throw new AppError("Too many attempts. Request a new code.", 429);
    }

    const matches = await deps.compareHash(input.code, pending.otpHash);
    if (!matches) {
        await deps.pendingStore.incrementAttempts(email);
        throw new AppError("Incorrect code", 401);
    }

    const user = await deps.userStore.create({
        email,
        name: pending.name,
        passwordHash: pending.passwordHash,
    });
    await deps.pendingStore.delete(email);
    deps.onUserCreated(user);

    return user;
}
