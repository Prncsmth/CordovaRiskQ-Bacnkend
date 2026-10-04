// src/services/passwordReset.service.ts
// Real Prisma + email wiring for passwordResetFlow.ts's pure logic --
// mirrors pendingRegistration.service.ts's role relative to
// pendingRegistrationFlow.ts, and shares its OTP config.
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/services/email.service";
import { loadOtpConfig } from "@/services/pendingRegistrationFlow";
import { passwordUpdateData } from "@/services/sessionAuth";
import { runInBackground } from "@/utils/runInBackground";
import { disconnectUserSockets } from "@/realtime/emit";
import {
    resetPassword,
    startPasswordResetRequest,
    type PasswordResetDeps,
    type PasswordResetStore,
    type PasswordResetUserStore,
} from "@/services/passwordResetFlow";

const resetStore: PasswordResetStore = {
    async findByEmail(email) {
        const row = await prisma.passwordResetOtp.findUnique({ where: { email } });
        if (!row) return null;
        return {
            email: row.email,
            otpHash: row.otpHash,
            otpExpiresAt: row.otpExpiresAt,
            attempts: row.attempts,
        };
    },
    async upsert(row) {
        const data = { otpHash: row.otpHash, otpExpiresAt: row.otpExpiresAt, attempts: row.attempts };
        await prisma.passwordResetOtp.upsert({
            where: { email: row.email },
            create: { email: row.email, ...data },
            update: data,
        });
    },
    async incrementAttempts(email) {
        await prisma.passwordResetOtp.update({
            where: { email },
            data: { attempts: { increment: 1 } },
        });
    },
    async consume(email) {
        // deleteMany reports how many rows it removed, so of two concurrent
        // requests with the same correct code only one sees count === 1.
        const { count } = await prisma.passwordResetOtp.deleteMany({ where: { email } });
        return count === 1;
    },
};

const userStore: PasswordResetUserStore = {
    async findByEmail(email) {
        // Case-insensitive, matching authService.login's lookup.
        const user = await prisma.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true, password: true },
        });
        return user ? { id: user.id, hasPassword: user.password !== null } : null;
    },
    async updatePassword(userId, passwordHash) {
        // Also revokes every existing session for this user (tokenVersion).
        await prisma.user.update({ where: { id: userId }, data: passwordUpdateData(passwordHash) });
    },
};

// bcrypt, same cost as registration. Exported so a test can confirm the real
// wiring stores a bcrypt hash, never the plain password or code.
export const passwordResetHashing = {
    hash: (value: string) => bcrypt.hash(value, 10),
    compareHash: (value: string, hash: string) => bcrypt.compare(value, hash),
};

const deps: PasswordResetDeps = {
    resetStore,
    userStore,
    ...passwordResetHashing,
    sendResetEmail: (to, code, expiryMinutes) => sendPasswordResetEmail(to, code, expiryMinutes),
    // The reset just revoked every session (tokenVersion); also drop any
    // socket still open for this user.
    onPasswordChanged: disconnectUserSockets,
    now: () => new Date(),
    // Same OTP_* settings as registration; read once at startup.
    config: loadOtpConfig(),
};

export const passwordResetService = {
    // Returns at once; the lookup and email happen in the background.
    requestReset(input: { email: string }) {
        return startPasswordResetRequest(input, deps, runInBackground);
    },

    reset(input: { email: string; code: string; newPassword: string }) {
        return resetPassword(input, deps);
    },
};
