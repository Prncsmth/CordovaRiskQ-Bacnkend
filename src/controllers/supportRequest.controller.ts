import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { supportRequestService } from "@/services/supportRequest.service";
import { asyncHandler } from "@/utils/asyncHandler";
import { queryInt, queryString } from "@/utils/queryParams";

export const supportRequestController = {
    create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const supportRequest = await supportRequestService.create(req.userId!, req.body);
        res.status(201).json({ success: true, supportRequest });
    }),

    listMine: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const supportRequests = await supportRequestService.listForUser(req.userId!);
        res.status(200).json({ success: true, supportRequests });
    }),

    listForAdmin: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const result = await supportRequestService.listForAdmin({
            search: queryString(req.query.search),
            status: queryString(req.query.status),
            page: queryInt(req.query.page),
            limit: queryInt(req.query.limit),
        });
        res.status(200).json({ success: true, ...result });
    }),

    updateStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const supportRequest = await supportRequestService.updateStatus(
            req.params.id as string,
            req.body.status
        );
        res.status(200).json({ success: true, supportRequest });
    }),
};
