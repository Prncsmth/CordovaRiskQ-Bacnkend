import { Request, Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { reviewService } from "@/services/review.service";
import { asyncHandler } from "@/utils/asyncHandler";
import { queryInt, queryString } from "@/utils/queryParams";

export const reviewController = {
    create: asyncHandler(async (req: Request, res: Response) => {
        await reviewService.create(req.body);
        // Same answer whether or not it was stored (honeypot), and no id leaked.
        res.status(201).json({
            success: true,
            message: "Thank you! Your review will appear once it has been checked.",
        });
    }),

    listPublic: asyncHandler(async (_req: Request, res: Response) => {
        const result = await reviewService.listPublic();
        res.status(200).json({ success: true, ...result });
    }),

    listForAdmin: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const result = await reviewService.listForAdmin({
            status: queryString(req.query.status),
            page: queryInt(req.query.page),
            limit: queryInt(req.query.limit),
        });
        res.status(200).json({ success: true, ...result });
    }),

    updateStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const review = await reviewService.updateStatus(req.params.id as string, req.body.status, req.userId!);
        res.status(200).json({ success: true, review });
    }),
};
