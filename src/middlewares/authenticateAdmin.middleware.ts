import { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/AppError";
import { verifyToken } from "@/utils/jwt";

export interface AuthenticatedAdminRequest extends Request {
    adminId?: string;
    adminRole?: string;
}

export function authenticateAdmin(
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next(new AppError("Missing or invalid Authorization header", 401));
    }

    const token = header.slice("Bearer ".length);

    try {
        const payload = verifyToken(token) as { adminId?: string; role?: string };
        if (!payload.adminId) {
            return next(new AppError("Invalid or expired token", 401));
        }
        req.adminId = payload.adminId;
        req.adminRole = payload.role;
        next();
    } catch {
        next(new AppError("Invalid or expired token", 401));
    }
}
