import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { hotlineService } from "@/services/hotline.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const hotlineController = {
    list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
        const hotlines = await hotlineService.list();
        res.status(200).json({ success: true, hotlines });
    }),

    update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const hotline = await hotlineService.update(req.params.id as string, req.body);
        res.status(200).json({ success: true, hotline });
    }),
};
