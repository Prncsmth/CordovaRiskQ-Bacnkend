import { NextFunction, Response } from "express";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";

// GET /incidents (the city-wide active-incident list) is responder/admin
// facing -- a citizen has GET /incidents/mine for their own reports instead.
// Neither requireResponder nor requireAdmin alone fits: the admin panel's
// own Emergencies/Live Map page reads this same endpoint, so a plain
// requireResponder would 403 every admin request.
export async function requireResponderOrAdmin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || (user.role !== "responder" && user.role !== "admin")) {
            return next(new AppError("Responder or admin access required", 403));
        }
        next();
    } catch (err) {
        next(err);
    }
}
