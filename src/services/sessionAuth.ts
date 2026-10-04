// Session tokens with revocation. Every JWT carries the user's tokenVersion
// at the time it was issued; changing or resetting the password bumps the
// user's tokenVersion (passwordUpdateData below), so every token issued
// before that stops verifying -- for that user only.
//
// Pure apart from the JWT helpers: the user lookup is injected, so this is
// unit-tested without a database. authenticate.middleware.ts and
// realtime/socket.ts supply the real Prisma-backed store.
import { signToken, verifyToken } from "@/utils/jwt";

export type SessionUser = { tokenVersion: number; role: string };

export interface SessionUserStore {
    findSessionUser(userId: string): Promise<SessionUser | null>;
}

export type Session = { userId: string; role: string };

export function issueSessionToken(user: { id: string; tokenVersion: number }): string {
    return signToken({ userId: user.id, tokenVersion: user.tokenVersion });
}

// Returns null for anything that isn't a current session: bad signature,
// expired, malformed, unknown/deleted user, or a version older than the
// user's current one. A store failure (e.g. the database being unreachable)
// throws instead, so callers can answer 500 rather than a 401 that would
// log the user out over a transient outage.
export async function verifySession(token: string, store: SessionUserStore): Promise<Session | null> {
    let payload: { userId?: unknown; tokenVersion?: unknown };
    try {
        payload = verifyToken(token) as typeof payload;
    } catch {
        return null;
    }

    if (typeof payload.userId !== "string" || payload.userId.length === 0) return null;

    // Tokens issued before tokenVersion existed carry no claim. They count as
    // version 0 -- every existing user's starting version -- so they keep
    // working until that user's first password change.
    const claimedVersion = payload.tokenVersion === undefined ? 0 : payload.tokenVersion;
    if (typeof claimedVersion !== "number") return null;

    const user = await store.findSessionUser(payload.userId);
    if (!user || user.tokenVersion !== claimedVersion) return null;

    return { userId: payload.userId, role: user.role };
}

// The one place a password is written for an existing user: sets the new
// hash and revokes every session issued before this moment.
export function passwordUpdateData(passwordHash: string) {
    return { password: passwordHash, tokenVersion: { increment: 1 } } as const;
}
