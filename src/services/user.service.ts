import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { disconnectUserSockets, emitAdminResponderDutyChanged } from "@/realtime/emit";
import { changePassword } from "@/services/changePasswordFlow";
import { issueSessionToken, passwordUpdateData } from "@/services/sessionAuth";

export const userService = {
    async getById(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new AppError("User not found", 404);

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
        };
    },

    async updateProfile(
        userId: string,
        data: { name?: string; email: string; mobile?: string }
    ) {
        // Matches authService's own normalizeEmail + case-insensitive lookup
        // (register/login) -- this exact-match version previously let a
        // second account claim a case-variant of an existing email (e.g.
        // "Bob@gmail.com" alongside "bob@gmail.com"), since the plain unique
        // index and this findUnique are both case-sensitive by default.
        const normalizedEmail = data.email.trim().toLowerCase();
        const existing = await prisma.user.findFirst({
            where: { email: { equals: normalizedEmail, mode: "insensitive" } },
        });
        if (existing && existing.id !== userId) {
            throw new AppError("Email already in use", 409);
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: {
                name: data.name,
                email: normalizedEmail,
                mobile: data.mobile,
            },
        });

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
        };
    },

    // Logs out every other session for this user and returns a fresh token
    // for the caller's own device (see changePasswordFlow.ts).
    changePassword(userId: string, data: { oldPassword: string; newPassword: string }) {
        return changePassword(userId, data, {
            findUser: (id) =>
                prisma.user.findUnique({ where: { id }, select: { id: true, password: true } }),
            compareHash: (value, hash) => bcrypt.compare(value, hash),
            hash: (value) => bcrypt.hash(value, 10),
            savePasswordAndRevokeSessions: (id, passwordHash) =>
                prisma.user.update({
                    where: { id },
                    data: passwordUpdateData(passwordHash),
                    select: { id: true, tokenVersion: true },
                }),
            issueToken: issueSessionToken,
            // Drops this user's open sockets too -- including this device's,
            // which reopens them with the fresh token it gets back.
            onPasswordChanged: disconnectUserSockets,
        });
    },

    async updatePushToken(userId: string, token: string | null) {
        if (token === null) {
            // Push-notifications opt-out -- just clear this user's own token,
            // no anti-collision cleanup needed since we're not writing a
            // token anywhere.
            await prisma.user.update({
                where: { id: userId },
                data: { pushToken: null },
            });
            return;
        }

        // Clear this token from any other user's row first -- on a shared
        // device, a stale token left behind after a logout/login switch
        // could otherwise deliver a different user's notifications to
        // whoever currently holds that device.
        await prisma.user.updateMany({
            where: { pushToken: token, id: { not: userId } },
            data: { pushToken: null },
        });
        await prisma.user.update({
            where: { id: userId },
            data: { pushToken: token },
        });
    },

    async updateDutyStatus(userId: string, isOnDuty: boolean) {
        const user = await prisma.user.update({
            where: { id: userId },
            data: { isOnDuty },
        });
        emitAdminResponderDutyChanged({ id: user.id, name: user.name, isOnDuty: user.isOnDuty });
    },
};
