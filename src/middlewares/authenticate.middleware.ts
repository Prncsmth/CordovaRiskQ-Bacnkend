import { NextFunction, Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { verifySession, type SessionUserStore } from "@/services/sessionAuth";

export interface AuthenticatedRequest extends Request {
    userId?: string;
    userRole?: string;
}

// Also used by realtime/socket.ts, so REST and sockets revoke together.
export const prismaSessionUserStore: SessionUserStore = {
    findSessionUser(userId) {
        return prisma.user.findUnique({
            where: { id: userId },
            select: { tokenVersion: true, role: true },
        });
    },
};

function bearerToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length);
}

export async function authenticate(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    const token = bearerToken(req);
    if (!token) {
        return next(new AppError("Missing or invalid Authorization header", 401));
    }

    try {
        // Rejects a token from before this user's last password change/reset.
        const session = await verifySession(token, prismaSessionUserStore);
        if (!session) {
            return next(new AppError("Invalid or expired token", 401));
        }
        req.userId = session.userId;
        req.userRole = session.role;
        next();
    } catch (err) {
        // Lookup failed (e.g. database down) -- a 500, not a 401, so the app
        // doesn't log the user out over a transient outage.
        next(err);
    }
}

// For public endpoints that show more to some signed-in roles (e.g. a
// Responders Only announcement). No token, or a token that isn't a current
// session, just means "anonymous" -- never a 401, so a stale token can't
// break public content or trigger the app's forced logout.
export async function optionalAuthenticate(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    const token = bearerToken(req);
    if (!token) return next();

    try {
        const session = await verifySession(token, prismaSessionUserStore);
        if (session) {
            req.userId = session.userId;
            req.userRole = session.role;
        }
        next();
    } catch (err) {
        next(err);
    }
}
