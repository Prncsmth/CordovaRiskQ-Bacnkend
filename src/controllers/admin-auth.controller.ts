import { Request, Response } from "express";
import { AuthenticatedAdminRequest } from "@/middlewares/authenticateAdmin.middleware";
import { adminAuthService } from "@/services/admin-auth.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const adminAuthController = {
    login: asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body;
        const result = await adminAuthService.login(email, password);
        res.status(200).json({ success: true, ...result });
    }),

    me: asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
        const user = await adminAuthService.getById(req.adminId!);
        res.status(200).json({ success: true, user });
    }),
};
