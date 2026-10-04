// src/services/pendingRegistration.service.ts
// Real Prisma + SMTP wiring for pendingRegistrationFlow.ts's pure logic --
// mirrors sos.service.ts's role relative to sosTrigger.ts.
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { emitAdminActivity } from "@/realtime/emit";
import { issueSessionToken } from "@/services/sessionAuth";
import { sendOtpEmail } from "@/services/email.service";
import {
    loadOtpConfig,
    requestRegistrationOtp,
    resendRegistrationOtp,
    verifyRegistrationOtp,
    type PendingRegistrationStore,
    type RegistrationOtpDeps,
    type UserStore,
} from "@/services/pendingRegistrationFlow";

const pendingStore: PendingRegistrationStore = {
    async findByEmail(email) {
        const row = await prisma.pendingRegistration.findUnique({ where: { email } });
        if (!row) return null;
        return {
            email: row.email,
            name: row.name,
            passwordHash: row.passwordHash,
            otpHash: row.otpHash,
            otpExpiresAt: row.otpExpiresAt,
            attempts: row.attempts,
        };
    },
    async upsert(row) {
        const data = {
            name: row.name,
            passwordHash: row.passwordHash,
            otpHash: row.otpHash,
            otpExpiresAt: row.otpExpiresAt,
            attempts: row.attempts,
        };
        await prisma.pendingRegistration.upsert({
            where: { email: row.email },
            create: { email: row.email, ...data },
            update: data,
        });
    },
    async incrementAttempts(email) {
        await prisma.pendingRegistration.update({
            where: { email },
            data: { attempts: { increment: 1 } },
        });
    },
    async consume(email) {
        // deleteMany reports how many rows it removed, so of two concurrent
        // requests with the same correct code only one sees count === 1.
        const { count } = await prisma.pendingRegistration.deleteMany({ where: { email } });
        return count === 1;
    },
};

const userStore: UserStore = {
    async findByEmail(email) {
        // Case-insensitive, matching authService.login's lookup -- email is
        // already lowercased by pendingRegistrationFlow, but a defensive
        // insensitive match costs nothing and stays consistent.
        const user = await prisma.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true },
        });
        return user;
    },
    async create(data) {
        const user = await prisma.user.create({
            data: { email: data.email, name: data.name, password: data.passwordHash },
        });
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isOnDuty: user.isOnDuty,
            createdAt: user.createdAt,
        };
    },
};

const deps: RegistrationOtpDeps = {
    pendingStore,
    userStore,
    hash: (value) => bcrypt.hash(value, 10),
    compareHash: (value, hash) => bcrypt.compare(value, hash),
    sendOtpEmail: (to, code, expiryMinutes) => sendOtpEmail(to, code, expiryMinutes),
    now: () => new Date(),
    // Read once at startup; restart the server after changing OTP_* values.
    config: loadOtpConfig(),
    onUserCreated: (user) => {
        emitAdminActivity({
            type: "user_registered",
            title: "New user registered",
            detail: user.name ?? user.email,
            occurredAt: user.createdAt.toISOString(),
        });
    },
};

export const pendingRegistrationService = {
    requestOtp(input: { name?: string; email: string; password: string }) {
        return requestRegistrationOtp(input, deps);
    },

    resendOtp(input: { email: string }) {
        return resendRegistrationOtp(input, deps);
    },

    async verifyOtp(input: { email: string; code: string }) {
        const user = await verifyRegistrationOtp(input, deps);
        // A brand-new account always starts at tokenVersion 0 (column default).
        const token = issueSessionToken({ id: user.id, tokenVersion: 0 });
        return {
            user: { id: user.id, email: user.email, name: user.name, role: user.role, isOnDuty: user.isOnDuty },
            token,
            // Always a brand-new account -- drives the phone-number/Terms
            // onboarding in the app.
            isNewUser: true,
        };
    },
};
