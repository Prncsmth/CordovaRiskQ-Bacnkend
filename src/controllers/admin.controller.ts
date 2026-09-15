import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { adminService } from "@/services/admin.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const adminController = {
    listUsers: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
        const users = await adminService.listUsers();
        res.status(200).json({ success: true, users });
    }),

    updateUserRole: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const user = await adminService.updateUserRole(req.params.id as string, req.body.role, req.body.unit);
        res.status(200).json({ success: true, user });
    }),

    getResponderSummary: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
        const summary = await adminService.getResponderSummary();
        res.status(200).json({ success: true, summary });
    }),

    getRecentActivity: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
        const activities = await adminService.getRecentActivity();
        res.status(200).json({ success: true, activities });
    }),
};
