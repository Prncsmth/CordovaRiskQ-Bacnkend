import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { evacuationCenterService } from "@/services/evacuationCenter.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const evacuationCenterController = {
    list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
        const centers = await evacuationCenterService.list();
        res.status(200).json({ success: true, centers });
    }),

    update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const center = await evacuationCenterService.update(req.params.id as string, req.body);
        res.status(200).json({ success: true, center });
    }),
};
