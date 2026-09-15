import { Response } from "express";
import { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import { sosService } from "@/services/sos.service";
import { asyncHandler } from "@/utils/asyncHandler";
import { queryDate, queryInt, queryString } from "@/utils/queryParams";
import type { AlertStatus } from "@/services/sosAlertStatus";

const ALERT_STATUSES: AlertStatus[] = ["New", "Acknowledged", "Resolved"];

function queryAlertStatus(value: unknown): AlertStatus | undefined {
    const str = queryString(value);
    return str && (ALERT_STATUSES as string[]).includes(str) ? (str as AlertStatus) : undefined;
}

export const sosController = {
    trigger: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const alert = await sosService.trigger(req.userId!, req.body);
        res.status(201).json({ success: true, alert });
    }),

    listForAdmin: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const result = await sosService.listForAdmin({
            status: queryString(req.query.status),
            barangay: queryString(req.query.barangay),
            search: queryString(req.query.search),
            alertStatus: queryAlertStatus(req.query.alertStatus),
            startDate: queryDate(req.query.startDate),
            endDate: queryDate(req.query.endDate),
            page: queryInt(req.query.page),
            limit: queryInt(req.query.limit),
        });
        res.status(200).json({ success: true, ...result });
    }),

    getAdminSummary: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
        const summary = await sosService.getAdminSummary();
        res.status(200).json({ success: true, summary });
    }),
};
