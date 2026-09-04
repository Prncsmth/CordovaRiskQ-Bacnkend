// src/controllers/notification.controller.ts
import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { notificationService } from "@/services/notification.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const notificationController = {
    list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const notifications = await notificationService.listForUser(req.userId!);
        res.status(200).json({ success: true, notifications });
    }),

    markRead: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await notificationService.markRead(req.params.id as string, req.userId!);
        res.status(200).json({ success: true });
    }),

    markAllRead: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await notificationService.markAllRead(req.userId!);
        res.status(200).json({ success: true });
    }),
};
