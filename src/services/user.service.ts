import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { deleteAvatar, isCloudinaryConfigured, uploadAvatar } from "@/lib/cloudinary";
import { disconnectUserSockets, emitAdminResponderDutyChanged } from "@/realtime/emit";
import { assertEmailUnchanged } from "@/services/accountEmail";
import { describeProfileChange } from "@/services/adminAuditDetails";
import { AUDITED_TRANSACTION_OPTIONS, logAdminAction, writeAdminAuditLog } from "@/services/adminAuditLog.service";
import { changePassword } from "@/services/changePasswordFlow";
import { issueSessionToken, passwordUpdateData } from "@/services/sessionAuth";

export const userService = {
    // Replaces the profile photo; the old one is removed from Cloudinary.
    async setAvatar(userId: string, file: Buffer) {
        if (!isCloudinaryConfigured()) {
            throw new AppError("Photo upload is not available right now", 503);
        }
        const current = await prisma.user.findUnique({
            where: { id: userId },
            select: { avatarUrl: true },
        });
        if (!current) throw new AppError("User not found", 404);
        const avatarUrl = await uploadAvatar(file);
        await prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
        if (current.avatarUrl) await deleteAvatar(current.avatarUrl);
        return avatarUrl;
    },

    async removeAvatar(userId: string) {
        const current = await prisma.user.findUnique({
            where: { id: userId },
            select: { avatarUrl: true },
        });
        if (!current) throw new AppError("User not found", 404);
        if (!current.avatarUrl) return;
        await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
        await deleteAvatar(current.avatarUrl);
    },

    async getById(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new AppError("User not found", 404);

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            avatarUrl: user.avatarUrl,
            // False for an account created through Google Sign-In, which has
            // no password -- the app hides Change Password for it.
            hasPassword: user.password !== null,
            // True for any account that signs in with Google -- Google-only,
            // or an email/password account later linked to Google. The app
            // shows its password row as "Password (Google Account)".
            isGoogleAccount: user.googleId !== null,
            // A responder's admin-set organization and home barangay, so the
            // app can open their Dashboard on their own barangay and show
            // where they're assigned. Re-read on each Dashboard visit, so an
            // admin's change shows up without logging in again.
            unit: user.unit,
            assignedBarangay: user.assignedBarangay,
        };
    },

    async updateProfile(
        userId: string,
        data: { name?: string; email?: string; mobile?: string }
    ) {
        const current = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, name: true, role: true },
        });
        if (!current) throw new AppError("User not found", 404);

        // The email is the account's verified login identity and can't be
        // changed here -- an unverified change enabled a Google-linking
        // account takeover (see accountEmail.ts). Sending the same email is
        // still fine.
        assertEmailUnchanged(current.email, data.email);

        const update = { where: { id: userId }, data: { name: data.name, mobile: data.mobile } };
        // An admin's own profile change (admin portal Settings) is an admin
        // action: saved together with its audit row. Citizens and responders
        // are not audited.
        const user =
            current.role === "admin"
                ? await prisma.$transaction(async (tx) => {
                      const updated = await tx.user.update(update);
                      await writeAdminAuditLog(tx, userId, "admin_profile_updated", describeProfileChange(current, updated), userId);
                      return updated;
                  }, AUDITED_TRANSACTION_OPTIONS)
                : await prisma.user.update(update);

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
        };
    },

    // Logs out every other session for this user and returns a fresh token
    // for the caller's own device (see changePasswordFlow.ts).
    async changePassword(userId: string, data: { oldPassword: string; newPassword: string }) {
        const result = await changePassword(userId, data, {
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

        // An admin changing their own password is recorded -- the action only,
        // never the old or new password or the token.
        const changed = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (changed?.role === "admin") {
            await logAdminAction(userId, "admin_password_changed", "Changed their password", userId);
        }
        return result;
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
