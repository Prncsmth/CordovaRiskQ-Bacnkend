import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { adminService } from "@/services/admin.service";
import { asyncHandler } from "@/utils/asyncHandler";
import { queryInt, queryString } from "@/utils/queryParams";

function queryBool(value: unknown): boolean | undefined {
    const str = queryString(value);
    if (str === "true") return true;
    if (str === "false") return false;
    return undefined;
}

export const adminController = {
    listUsers: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const result = await adminService.listUsers({
            search: queryString(req.query.search),
            role: queryString(req.query.role),
            duty: queryBool(req.query.duty),
            unit: queryString(req.query.unit),
            page: queryInt(req.query.page),
            limit: queryInt(req.query.limit),
        });
        res.status(200).json({ success: true, ...result });
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
