// src/services/pendingRegistration.service.ts
// Real Prisma + Resend wiring for pendingRegistrationFlow.ts's pure logic --
// mirrors sos.service.ts's role relative to sosTrigger.ts.
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { emitAdminActivity } from "@/realtime/emit";
import { signToken } from "@/utils/jwt";
import { sendOtpEmail } from "@/services/email.service";
import {
    requestRegistrationOtp,
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
        await prisma.pendingRegistration.upsert({
            where: { email: row.email },
            create: {
                email: row.email,
                name: row.name,
                passwordHash: row.passwordHash,
                otpHash: row.otpHash,
                otpExpiresAt: row.otpExpiresAt,
                attempts: row.attempts,
            },
            update: {
                name: row.name,
                passwordHash: row.passwordHash,
                otpHash: row.otpHash,
                otpExpiresAt: row.otpExpiresAt,
                attempts: row.attempts,
            },
        });
    },
    async incrementAttempts(email) {
        await prisma.pendingRegistration.update({
            where: { email },
            data: { attempts: { increment: 1 } },
        });
    },
    async delete(email) {
        await prisma.pendingRegistration.delete({ where: { email } }).catch(() => {});
    },
};

const userStore: UserStore = {
    async findByEmail(email) {
        // Case-insensitive, matching authService.register/updateProfile's
        // existing convention -- email here is already lowercased by
        // pendingRegistrationFlow before this is called, but a defensive
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
    sendOtpEmail,
    now: () => new Date(),
    onUserCreated: (user) => {
        // Same event authService.register emits today on direct-create.
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

    async verifyOtp(input: { email: string; code: string }) {
        const user = await verifyRegistrationOtp(input, deps);
        const token = signToken({ userId: user.id });
        return {
            user: { id: user.id, email: user.email, name: user.name, role: user.role, isOnDuty: user.isOnDuty },
            token,
        };
    },
};
