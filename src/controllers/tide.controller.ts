// src/controllers/tide.controller.ts
import { Request, Response } from "express";
import { tideService } from "@/services/tide.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const tideController = {
    getStatus: asyncHandler(async (req: Request, res: Response) => {
        const tide = await tideService.getLatest();
        res.status(200).json({ success: true, tide });
    }),
};
