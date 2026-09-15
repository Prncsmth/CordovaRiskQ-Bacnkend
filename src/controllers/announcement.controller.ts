import { Request, Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { announcementService } from "@/services/announcement.service";
import { asyncHandler } from "@/utils/asyncHandler";
import { queryInt, queryString } from "@/utils/queryParams";

export const announcementController = {
    getActive: asyncHandler(async (req: Request, res: Response) => {
        const barangay = typeof req.query.barangay === "string" ? req.query.barangay : undefined;
        const announcement = await announcementService.getActive(barangay);
        res.status(200).json({ success: true, announcement });
    }),

    listForAdmin: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const result = await announcementService.listForAdmin({
            search: queryString(req.query.search),
            priority: queryString(req.query.priority),
            page: queryInt(req.query.page),
            limit: queryInt(req.query.limit),
        });
        res.status(200).json({ success: true, ...result });
    }),

    create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const announcement = await announcementService.create(req.userId!, req.body);
        res.status(201).json({ success: true, announcement });
    }),

    remove: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await announcementService.remove(req.params.id as string);
        res.status(200).json({ success: true });
    }),
};
