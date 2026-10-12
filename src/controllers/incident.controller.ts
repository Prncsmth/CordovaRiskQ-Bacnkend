import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { incidentService } from "@/services/incident.service";
import { trackingService } from "@/services/tracking.service";
import { isCloudinaryConfigured, uploadIncidentPhoto } from "@/lib/cloudinary";
import { AppError } from "@/utils/AppError";
import { asyncHandler } from "@/utils/asyncHandler";
import { emitIncidentUpdate } from "@/realtime/emit";

export const incidentController = {
    create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.create(req.userId!, req.body);
        res.status(201).json({ success: true, incident });
    }),

    uploadPhoto: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        if (!isCloudinaryConfigured()) {
            throw new AppError("Photo upload is not available right now", 503);
        }
        if (!req.file) throw new AppError("Attach a photo in the \"photo\" field", 400);
        const photoUrl = await uploadIncidentPhoto(req.file.buffer);
        res.status(201).json({ success: true, photoUrl });
    }),

    list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incidents = await incidentService.list(req.userId!);
        res.status(200).json({ success: true, incidents });
    }),

    listMine: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incidents = await incidentService.listByReporter(req.userId!);
        res.status(200).json({ success: true, incidents });
    }),

    listCompleted: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incidents = await incidentService.listCompletedByResponder(req.userId!);
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
        emitIncidentUpdate(incident.id, {
            id: incident.id,
            status: incident.status,
            responders: incident.responders,
            respondersCount: incident.respondersCount,
            acceptedByResponderId: incident.acceptedByResponderId,
            updatedAt: incident.updatedAt.toISOString(),
        });
        res.status(200).json({ success: true, incident });
    }),

    updateStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.updateStatus(
            req.params.id as string,
            req.userId!,
            req.body.status
        );
        emitIncidentUpdate(incident.id, {
            id: incident.id,
            status: incident.status,
            responders: incident.responders,
            respondersCount: incident.respondersCount,
            acceptedByResponderId: incident.acceptedByResponderId,
            updatedAt: incident.updatedAt.toISOString(),
        });
        res.status(200).json({ success: true, incident });
    }),

    cancelByReporter: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const incident = await incidentService.cancelByReporter(req.params.id as string, req.userId!);
        emitIncidentUpdate(incident.id, {
            id: incident.id,
            status: incident.status,
            responders: incident.responders,
            respondersCount: incident.respondersCount,
            acceptedByResponderId: incident.acceptedByResponderId,
            updatedAt: incident.updatedAt.toISOString(),
        });
        res.status(200).json({ success: true });
    }),

    ringTeam: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await incidentService.ringTeam(req.params.id as string, req.userId!);
        res.status(200).json({ success: true });
    }),

    removeOwnReport: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        await incidentService.removeOwnReport(req.params.id as string, req.userId!);
        res.status(200).json({ success: true });
    }),

    getTracking: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const tracking = await trackingService.getForIncident(req.params.id as string, req.userId!);
        res.status(200).json({ success: true, tracking });
    }),
};
