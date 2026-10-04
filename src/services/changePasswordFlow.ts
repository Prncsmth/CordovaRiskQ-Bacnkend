// Pure logic for POST /api/users/change-password (user.service.ts supplies
// the Prisma + bcrypt wiring). Saving the new password revokes every
// existing session for this user, including the one making the request --
// so a fresh token is issued for that device and returned, letting it stay
// signed in while every other device is logged out.
import { AppError } from "@/utils/AppError";

export interface ChangePasswordDeps {
    findUser(userId: string): Promise<{ id: string; password: string | null } | null>;
    compareHash(value: string, hash: string): Promise<boolean>;
    hash(value: string): Promise<string>;
    // Must also bump tokenVersion (see sessionAuth.passwordUpdateData) and
    // return the updated version.
    savePasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<{ id: string; tokenVersion: number }>;
    issueToken(user: { id: string; tokenVersion: number }): string;
    // Runs right after the new password is saved (production: disconnect the
    // user's live sockets). Must not throw.
    onPasswordChanged(userId: string): void;
}

export async function changePassword(
    userId: string,
    data: { oldPassword: string; newPassword: string },
    deps: ChangePasswordDeps,
): Promise<{ token: string }> {
    const user = await deps.findUser(userId);
    if (!user) throw new AppError("User not found", 404);

    if (!user.password) {
        throw new AppError(
            "This account uses Google Sign-In and has no password to change.",
            403
        );
    }

    const isMatch = await deps.compareHash(data.oldPassword, user.password);
    if (!isMatch) throw new AppError("Old password is incorrect", 403);

    const updated = await deps.savePasswordAndRevokeSessions(userId, await deps.hash(data.newPassword));
    deps.onPasswordChanged(userId);
    return { token: deps.issueToken(updated) };
}
