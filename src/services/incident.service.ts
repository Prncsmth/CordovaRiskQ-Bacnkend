import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";
import {
    deriveIncidentStatus,
    isActiveStatus,
    isRosterTransitionAllowed,
    otherActiveResponderIds,
    pickAcceptedByResponderId,
    type ResponderRosterStatus,
} from "@/services/incidentRoster";
import { canViewIncident } from "@/services/incidentAuthorization";

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

// Copy shown to a responder's teammates (never the actor) when the actor's
// own roster row changes on an incident they're already helping with.
// "declined" is intentionally absent: a decline never leaves any prior row
// for anyone else to have seen the responder join in the first place, so it
// has nobody to notify.
const ROSTER_NOTIFICATION_COPY: Partial<
    Record<ResponderRosterStatus, (name: string) => { title: string; body: string }>
> = {
    joined: (name) => ({ title: "Responder joined", body: `${name} joined this incident.` }),
    on_the_way: (name) => ({ title: "Responder en route", body: `${name} is on the way.` }),
    arrived: (name) => ({ title: "Responder arrived", body: `${name} arrived on scene.` }),
    left: (name) => ({ title: "Responder left", body: `${name} left this incident.` }),
};

const CLOSED_INCIDENT_NOTIFICATION_COPY: Record<"completed" | "cancelled", { title: string; body: string }> = {
    completed: { title: "Incident completed", body: "This incident has been marked completed." },
    cancelled: { title: "Incident cancelled", body: "This incident has been cancelled." },
};

async function notifyTeammatesOfRosterChange(
    incidentId: string,
    actorId: string,
    actorName: string,
    targetStatus: ResponderRosterStatus,
    allRows: { responderId: string; status: string }[],
) {
    const copy = ROSTER_NOTIFICATION_COPY[targetStatus];
    if (!copy) return;
    const recipients = otherActiveResponderIds(
        allRows.map((r) => ({ responderId: r.responderId, status: r.status as ResponderRosterStatus })),
        actorId,
    );
    if (recipients.length === 0) return;
    await notificationService.createForUsers(recipients, {
        type: "roster_update",
        ...copy(actorName),
        referenceId: incidentId,
    });
}

async function notifyTeammatesOfClosure(
    incidentId: string,
    actorId: string,
    status: "completed" | "cancelled",
    allRows: { responderId: string; status: string }[],
) {
    const recipients = otherActiveResponderIds(
        allRows.map((r) => ({ responderId: r.responderId, status: r.status as ResponderRosterStatus })),
        actorId,
    );
    if (recipients.length === 0) return;
    await notificationService.createForUsers(recipients, {
        type: "roster_update",
        ...CLOSED_INCIDENT_NOTIFICATION_COPY[status],
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
        const incident = await prisma.incident.create({
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
        await notificationService.createForAllResponders({
            type: "new_incident",
            title: "New incident reported",
            body: `A ${data.category} incident was reported near ${data.locationLabel}.`,
            referenceId: incident.id,
        });
        return incident;
    },

    async createFromSos(
        reporterId: string,
        sosAlertId: string,
        data: { latitude?: number; longitude?: number; locationLabel?: string }
    ) {
        const incident = await prisma.incident.create({
            data: {
                source: "sos",
                reporterId,
                sosAlertId,
                category: "sos",
                // Falls back to the old placeholder only when no location was
                // available at trigger time (e.g. permission denied) -- the
                // frontend computes a real nearest-barangay label whenever it
                // has device coordinates, same as the citizen report flow.
                locationLabel: data.locationLabel ?? "SOS Alert",
                latitude: data.latitude,
                longitude: data.longitude,
                urgency: "high",
            },
        });
        await notificationService.createForAllResponders({
            type: "new_incident",
            title: "SOS alert",
            body: "An SOS alert was triggered nearby.",
            referenceId: incident.id,
        });
        return incident;
    },

    async list(responderId: string) {
        const incidents = await prisma.incident.findMany({
            where: {
                status: { in: NON_TERMINAL_STATUSES },
                responders: { none: { responderId, status: "declined" } },
            },
            orderBy: { createdAt: "desc" },
            include: { responders: { include: { responder: { select: { name: true } } } } },
        });

        return incidents.map(({ responders, ...incident }) => {
            const shaped = shapeResponders(responders);
            const myRow = responders.find((r) => r.responderId === responderId);
            return {
                ...incident,
                acceptedByResponderId: shaped.acceptedByResponderId,
                respondersCount: shaped.respondersCount,
                myStatus: myRow?.status ?? "pending",
            };
        });
    },

    async listByReporter(reporterId: string) {
        return prisma.incident.findMany({
            where: { reporterId },
            orderBy: { createdAt: "desc" },
        });
    },

    async listCompletedByResponder(responderId: string) {
        return prisma.incident.findMany({
            where: {
                status: "completed",
                responders: { some: { responderId, status: { not: "declined" } } },
            },
            orderBy: { updatedAt: "desc" },
        });
    },

    async getById(id: string, requesterId: string) {
        const incident = await prisma.incident.findUnique({
            where: { id },
            include: { responders: { include: { responder: { select: { name: true } } } } },
        });
        if (!incident) throw new AppError("Incident not found", 404);

        const requester = await prisma.user.findUnique({ where: { id: requesterId } });
        if (!canViewIncident(requester?.role, incident.reporterId, requesterId)) {
            throw new AppError("Not your report", 403);
        }

        if (requester?.role === "citizen") {
            const shaped = shapeResponders(incident.responders);
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
            };
        }

        return buildResponderFacingIncident(incident, incident.responders, requesterId);
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

        const actorName = allRows.find((r) => r.responderId === responderId)?.responder.name ?? "A responder";
        await notifyTeammatesOfRosterChange(id, responderId, actorName, targetStatus, allRows);

        return buildResponderFacingIncident(updatedIncident, allRows, responderId);
    },

    async updateStatus(id: string, responderId: string, status: "completed" | "cancelled") {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        const myRow = await prisma.incidentResponder.findUnique({
            where: { incidentId_responderId: { incidentId: id, responderId } },
        });
        if (myRow?.status !== "arrived") {
            throw new AppError("You must be on-scene to close this incident", 403);
        }

        // No-op a retried/duplicate PATCH that doesn't actually change the
        // status -- avoids re-updating updatedAt and re-notifying the
        // reporter/teammates for a status they were already notified about.
        const statusChanged = incident.status !== status;
        let updatedIncident = incident;
        if (statusChanged) {
            updatedIncident = await prisma.incident.update({
                where: { id },
                data: { status },
            });
            await notifyStatusChange(
                updatedIncident.reporterId,
                updatedIncident.id,
                updatedIncident.status,
                updatedIncident.source,
            );
        }

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true } } },
        });

        if (statusChanged) {
            await notifyTeammatesOfClosure(id, responderId, status, allRows);
        }

        return buildResponderFacingIncident(updatedIncident, allRows, responderId);
    },

    async ringTeam(id: string, responderId: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true } } },
        });

        const myRow = allRows.find((r) => r.responderId === responderId);
        if (!myRow || !isActiveStatus(myRow.status as ResponderRosterStatus)) {
            throw new AppError("You must be helping this incident to ring the team", 403);
        }

        const recipients = otherActiveResponderIds(
            allRows.map((r) => ({ responderId: r.responderId, status: r.status as ResponderRosterStatus })),
            responderId,
        );
        if (recipients.length === 0) return;

        await notificationService.createForUsers(recipients, {
            type: "team_ring",
            title: "Team ring",
            body: `${myRow.responder.name ?? "A responder"} is calling for backup on this incident.`,
            referenceId: id,
        });
    },
};
