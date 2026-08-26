import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { sosService } from "@/services/sos.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const sosController = {
    trigger: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const alert = await sosService.trigger(req.userId!, req.body);
        res.status(201).json({ success: true, alert });
    }),
};
