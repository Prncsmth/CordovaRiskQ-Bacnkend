import { NextFunction, Response } from "express";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";

export async function requireAdmin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== "admin") {
            return next(new AppError("Admin access required", 403));
        }
        next();
    } catch (err) {
        next(err);
    }
}
