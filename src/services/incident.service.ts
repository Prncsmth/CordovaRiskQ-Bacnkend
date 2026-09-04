import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";

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

async function notifyStatusChange(reporterId: string, status: string, source?: string) {
    const copy =
        (source === "sos" ? SOS_STATUS_NOTIFICATION_COPY[status] : undefined) ??
        STATUS_NOTIFICATION_COPY[status];
    if (!copy) return;
    await notificationService.createForUsers([reporterId], {
        type: "incident_status",
        title: copy.title,
        body: copy.body,
    });
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

    async getById(id: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);
        return incident;
    },

    async accept(id: string, responderId: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);
        if (incident.status !== "pending") {
            throw new AppError("Incident already accepted", 409);
        }

        const updated = await prisma.incident.update({
            where: { id },
            data: { status: "lobby", acceptedByResponderId: responderId },
        });

        await notifyStatusChange(updated.reporterId, updated.status, updated.source);
        return updated;
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

        await notifyStatusChange(updated.reporterId, updated.status, updated.source);
        return updated;
    },
};
