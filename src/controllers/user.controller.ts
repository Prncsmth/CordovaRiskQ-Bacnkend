import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { userService } from "@/services/user.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const userController = {
    getMe: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const user = await userService.getById(req.userId!);
        res.status(200).json({ success: true, user });
    }),

    updateProfile: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const user = await userService.updateProfile(req.userId!, req.body);
        res.status(200).json({ success: true, user });
    }),

    changePassword: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        // A fresh token for this device -- the old one was just revoked along
        // with every other session for this user.
        const { token } = await userService.changePassword(req.userId!, req.body);
        res.status(200).json({ success: true, token });
    }),

    updatePushToken: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await userService.updatePushToken(req.userId!, req.body.token);
        res.status(200).json({ success: true });
    }),

    updateDutyStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await userService.updateDutyStatus(req.userId!, req.body.isOnDuty);
        res.status(200).json({ success: true });
    }),
};
