import { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/AppError";
import { verifyToken } from "@/utils/jwt";

export interface AuthenticatedRequest extends Request {
    userId?: string;
}

export function authenticate(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next(new AppError("Missing or invalid Authorization header", 401));
    }

    const token = header.slice("Bearer ".length);

    try {
        const payload = verifyToken(token) as { userId?: string };
        if (!payload.userId) {
            return next(new AppError("Invalid or expired token", 401));
        }
        req.userId = payload.userId;
        next();
    } catch {
        next(new AppError("Invalid or expired token", 401));
    }
}
