import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { userService } from "@/services/user.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const userController = {
    getMe: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const user = await userService.getById(req.userId!);
        res.status(200).json({ success: true, user });
    }),
};
