import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { trackingService } from "@/services/tracking.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const responderController = {
    updateLocation: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await trackingService.updateResponderLocation(req.userId!, req.body);
        res.status(200).json({ success: true });
    }),
};
