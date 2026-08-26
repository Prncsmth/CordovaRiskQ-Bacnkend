import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const URGENCY_BY_CATEGORY: Record<string, string> = {
    fire: "high",
    medical: "high",
    flood: "medium",
    "road-accident": "medium",
    other: "low",
};

const NON_TERMINAL_STATUSES = ["pending", "lobby", "on_the_way", "arrived"];

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

        return prisma.incident.update({
            where: { id },
            data: { status: "lobby", acceptedByResponderId: responderId },
        });
    },

    async updateStatus(id: string, responderId: string, status: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);
        if (incident.acceptedByResponderId !== responderId) {
            throw new AppError("Not your incident", 403);
        }

        return prisma.incident.update({
            where: { id },
            data: { status },
        });
    },
};
