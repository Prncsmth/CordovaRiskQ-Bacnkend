import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";
import {
    deriveIncidentStatus,
    isActiveStatus,
    isRosterTransitionAllowed,
    pickAcceptedByResponderId,
    type ResponderRosterStatus,
} from "@/services/incidentRoster";

const URGENCY_BY_CATEGORY: Record<string, string> = {
    fire: "high",
    medical: "high",
    flood: "medium",
    "road-accident": "medium",
    other: "low",
};

const NON_TERMINAL_STATUSES = ["pending", "lobby", "on_the_way", "arrived"];

const STATUS_NOTIFICATION_COPY: Record<string, { title: string; body: string }> = {
    lobby: { title: "Responder assigned", body: "A responder has accepted your report." },
    on_the_way: { title: "Responder en route", body: "Your responder is on the way." },
    arrived: { title: "Responder arrived", body: "Your responder has arrived at the location." },
    completed: { title: "Report resolved", body: "Your report has been resolved." },
    cancelled: { title: "Report cancelled", body: "Your report was cancelled." },
};

// SOS-sourced incidents don't have a reporter-authored "report" -- swap in
// alert-appropriate copy for the statuses whose default text says "report".
const SOS_STATUS_NOTIFICATION_COPY: Partial<Record<string, { title: string; body: string }>> = {
    lobby: { title: "Responder assigned", body: "A responder has accepted your SOS alert." },
    completed: { title: "Alert resolved", body: "Your SOS alert has been resolved." },
    cancelled: { title: "Alert cancelled", body: "Your SOS alert was cancelled." },
};

async function notifyStatusChange(
    reporterId: string,
    incidentId: string,
    status: string,
    source?: string
) {
    const copy =
        (source === "sos" ? SOS_STATUS_NOTIFICATION_COPY[status] : undefined) ??
        STATUS_NOTIFICATION_COPY[status];
    if (!copy) return;
    await notificationService.createForUsers([reporterId], {
        type: "incident_status",
        title: copy.title,
        body: copy.body,
        referenceId: incidentId,
    });
}

type ResponderRowWithName = {
    id: string;
    responderId: string;
    status: string;
    createdAt: Date;
    responder: { name: string | null };
};

function shapeResponders(rows: ResponderRowWithName[]) {
    const activeRows = rows.filter((r) => isActiveStatus(r.status as ResponderRosterStatus));
    return {
        respondersCount: activeRows.length,
        acceptedByResponderId: pickAcceptedByResponderId(
            rows.map((r) => ({
                id: r.id,
                responderId: r.responderId,
                status: r.status as ResponderRosterStatus,
                createdAt: r.createdAt,
            })),
        ),
        activeResponders: activeRows.map((r) => ({
            id: r.responderId,
            name: r.responder.name ?? "Responder",
            status: r.status,
        })),
    };
}

// The full shape any responder-facing endpoint returns for one incident:
// the citizen-safe fields plus the roster summary and the caller's own
// status. Used by updateMyResponderStatus/updateStatus (this file, below)
// and by list()/getById() (Task 6) so every endpoint a responder hits
// returns a consistent, fully-populated shape -- critical for
// updateMyResponderStatus specifically, since the frontend derives its
// next UI phase directly from this response's `myStatus`.
function buildResponderFacingIncident(
    incident: {
        id: string;
        category: string;
        details: string | null;
        locationLabel: string;
        latitude: number | null;
        longitude: number | null;
        urgency: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    },
    responderRows: ResponderRowWithName[],
    requesterId: string,
) {
    const shaped = shapeResponders(responderRows);
    const myRow = responderRows.find((r) => r.responderId === requesterId);
    return {
        id: incident.id,
        category: incident.category,
        details: incident.details,
        locationLabel: incident.locationLabel,
        latitude: incident.latitude,
        longitude: incident.longitude,
        urgency: incident.urgency,
        status: incident.status,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
        respondersCount: shaped.respondersCount,
        acceptedByResponderId: shaped.acceptedByResponderId,
        responders: shaped.activeResponders,
        myStatus: myRow?.status ?? "pending",
    };
}

export const incidentService = {
    async create(
        reporterId: string,
        data: {
            category: string;
            details?: string;
            locationLabel: string;
            latitude: number;
            longitude: number;
        }
    ) {
        return prisma.incident.create({
            data: {
                source: "report",
                reporterId,
                category: data.category,
                details: data.details,
                locationLabel: data.locationLabel,
                latitude: data.latitude,
                longitude: data.longitude,
                urgency: URGENCY_BY_CATEGORY[data.category] ?? "low",
            },
        });
    },

    async createFromSos(
        reporterId: string,
        sosAlertId: string,
        data: { latitude?: number; longitude?: number }
    ) {
        return prisma.incident.create({
            data: {
                source: "sos",
                reporterId,
                sosAlertId,
                category: "sos",
                locationLabel: "SOS Alert",
                latitude: data.latitude,
                longitude: data.longitude,
                urgency: "high",
            },
        });
    },

    async list() {
        return prisma.incident.findMany({
            where: { status: { in: NON_TERMINAL_STATUSES } },
            orderBy: { createdAt: "desc" },
        });
    },

    async listByReporter(reporterId: string) {
        return prisma.incident.findMany({
            where: { reporterId },
            orderBy: { createdAt: "desc" },
        });
    },

    async getById(id: string, requesterId: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        const requester = await prisma.user.findUnique({ where: { id: requesterId } });
        if (requester?.role === "citizen" && incident.reporterId !== requesterId) {
            throw new AppError("Not your report", 403);
        }

        // Shaped rather than the raw row -- keeps internal identifiers
        // (reporterId, acceptedByResponderId, sosAlertId, source) off the
        // wire now that citizens hit this endpoint directly for their own
        // report detail, not just responders viewing incidents to accept.
        return {
            id: incident.id,
            category: incident.category,
            details: incident.details,
            locationLabel: incident.locationLabel,
            latitude: incident.latitude,
            longitude: incident.longitude,
            urgency: incident.urgency,
            status: incident.status,
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt,
        };
    },

    async updateMyResponderStatus(
        id: string,
        responderId: string,
        targetStatus: ResponderRosterStatus,
    ) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        const existingRow = await prisma.incidentResponder.findUnique({
            where: { incidentId_responderId: { incidentId: id, responderId } },
        });
        const currentStatus = (existingRow?.status as ResponderRosterStatus | undefined) ?? null;

        if (!isRosterTransitionAllowed(currentStatus, targetStatus)) {
            throw new AppError(
                `Cannot move from ${currentStatus ?? "no status"} to ${targetStatus}`,
                409,
            );
        }

        await prisma.incidentResponder.upsert({
            where: { incidentId_responderId: { incidentId: id, responderId } },
            update: { status: targetStatus },
            create: { incidentId: id, responderId, status: targetStatus },
        });

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true } } },
        });
        const activeStatuses = allRows
            .filter((r) => isActiveStatus(r.status as ResponderRosterStatus))
            .map((r) => r.status as ResponderRosterStatus);
        const newStatus = deriveIncidentStatus(activeStatuses);

        let updatedIncident = incident;
        if (newStatus !== incident.status) {
            updatedIncident = await prisma.incident.update({ where: { id }, data: { status: newStatus } });
            await notifyStatusChange(
                updatedIncident.reporterId,
                updatedIncident.id,
                updatedIncident.status,
                updatedIncident.source,
            );
        }

        return buildResponderFacingIncident(updatedIncident, allRows, responderId);
    },

    async updateStatus(id: string, responderId: string, status: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);
        if (incident.acceptedByResponderId !== responderId) {
            throw new AppError("Not your incident", 403);
        }

        // No-op a retried/duplicate PATCH that doesn't actually change the
        // status -- avoids re-updating updatedAt and re-notifying the
        // reporter for a status they were already notified about.
        if (incident.status === status) {
            return incident;
        }

        const updated = await prisma.incident.update({
            where: { id },
            data: { status },
        });

        await notifyStatusChange(updated.reporterId, updated.id, updated.status, updated.source);
        return updated;
    },
};
