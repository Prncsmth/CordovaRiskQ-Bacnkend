import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { incidentService } from "@/services/incident.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const incidentController = {
    create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.create(req.userId!, req.body);
        res.status(201).json({ success: true, incident });
    }),

    list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incidents = await incidentService.list();
        res.status(200).json({ success: true, incidents });
    }),

    listMine: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incidents = await incidentService.listByReporter(req.userId!);
        res.status(200).json({ success: true, incidents });
    }),

    getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.getById(req.params.id as string, req.userId!);
        res.status(200).json({ success: true, incident });
    }),

    updateMyResponderStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.updateMyResponderStatus(
            req.params.id as string,
            req.userId!,
            req.body.status,
        );
        res.status(200).json({ success: true, incident });
    }),

    updateStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.updateStatus(
            req.params.id as string,
            req.userId!,
            req.body.status
        );
        res.status(200).json({ success: true, incident });
    }),
};
