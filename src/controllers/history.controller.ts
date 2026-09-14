import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { historyService } from "@/services/history.service";
import { asyncHandler } from "@/utils/asyncHandler";
import { queryDate, queryInt, queryString } from "@/utils/queryParams";

export const historyController = {
    list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const result = await historyService.list({
            status: queryString(req.query.status),
            category: queryString(req.query.category),
            barangay: queryString(req.query.barangay),
            responderId: queryString(req.query.responderId),
            startDate: queryDate(req.query.startDate),
            endDate: queryDate(req.query.endDate),
            page: queryInt(req.query.page),
            limit: queryInt(req.query.limit),
        });
        res.status(200).json({ success: true, ...result });
    }),

    getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const record = await historyService.getById(req.params.id as string);
        res.status(200).json({ success: true, record });
    }),
};
