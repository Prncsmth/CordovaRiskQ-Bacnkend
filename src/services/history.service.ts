import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const TERMINAL_STATUSES = ["completed", "cancelled"];

const RESPONDER_STATUS_LABEL: Record<string, string> = {
    joined: "joined",
    on_the_way: "headed en route",
    arrived: "arrived on scene",
    left: "left the incident",
    declined: "declined the incident",
};

type HistoryResponderRow = {
    responderId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    responder: { name: string | null };
};

type HistoryIncident = {
    id: string;
    source: string;
    category: string;
    details: string | null;
    locationLabel: string;
    latitude: number | null;
    longitude: number | null;
    urgency: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    reporter: { id: string; name: string | null };
    responders: HistoryResponderRow[];
};

// Response time isn't tracked as its own field -- approximated as the time
// from the report to the earliest responder row that reached "arrived".
// Reliable for closed incidents since updateStatus (incident.service.ts)
// requires the closer to already be "arrived", and nothing moves a
// responder's status after that.
function computeResponseTimeSeconds(incident: HistoryIncident): number | null {
    const arrivedTimes = incident.responders
        .filter((r) => r.status === "arrived")
        .map((r) => r.updatedAt.getTime());
    if (arrivedTimes.length === 0) return null;

    const earliestArrival = Math.min(...arrivedTimes);
    return Math.round((earliestArrival - incident.createdAt.getTime()) / 1000);
}

function shapeListItem(incident: HistoryIncident) {
    return {
        id: incident.id,
        source: incident.source,
        category: incident.category,
        locationLabel: incident.locationLabel,
        latitude: incident.latitude,
        longitude: incident.longitude,
        urgency: incident.urgency,
        status: incident.status,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
        reporter: incident.reporter,
        responders: incident.responders.map((r) => ({
            id: r.responderId,
            name: r.responder.name ?? "Responder",
            status: r.status,
        })),
        responseTimeSeconds: computeResponseTimeSeconds(incident),
    };
}

// Best-effort timeline synthesized from the timestamps the schema actually
// keeps: one createdAt/updatedAt pair per responder row (their *current*
// status, not every transition they passed through) plus the incident's own
// createdAt/updatedAt. Good enough for a human-readable history view without
// adding a dedicated status-change-log table.
function buildTimeline(incident: HistoryIncident): { label: string; at: Date }[] {
    const events: { label: string; at: Date }[] = [
        { label: "Reported", at: incident.createdAt },
    ];

    for (const row of incident.responders) {
        const name = row.responder.name ?? "A responder";
        events.push({ label: `${name} joined`, at: row.createdAt });

        if (row.status !== "joined" && row.updatedAt.getTime() !== row.createdAt.getTime()) {
            const label = RESPONDER_STATUS_LABEL[row.status] ?? row.status;
            events.push({ label: `${name} ${label}`, at: row.updatedAt });
        }
    }

    if (TERMINAL_STATUSES.includes(incident.status)) {
        events.push({ label: `Incident ${incident.status}`, at: incident.updatedAt });
    }

    return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export const historyService = {
    async list(filters: {
        status?: string;
        category?: string;
        barangay?: string;
        responderId?: string;
        startDate?: Date;
        endDate?: Date;
        page?: number;
        limit?: number;
    }) {
        const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
        const limit =
            filters.limit && filters.limit > 0 ? Math.min(Math.floor(filters.limit), 100) : 20;

        const where = {
            status: { in: filters.status ? [filters.status] : TERMINAL_STATUSES },
            ...(filters.category ? { category: filters.category } : {}),
            ...(filters.barangay
                ? { locationLabel: { contains: filters.barangay, mode: "insensitive" as const } }
                : {}),
            ...(filters.responderId
                ? { responders: { some: { responderId: filters.responderId } } }
                : {}),
            // Filters on when the incident was resolved/cancelled (updatedAt),
            // not when it was originally reported (createdAt) -- this is a
            // report of terminal incidents, and updatedAt is already treated
            // as the completion/cancellation timestamp elsewhere in this file
            // (buildTimeline, computeResponseTimeSeconds). Filtering on
            // createdAt instead made "Today"/"This Week" show nothing for any
            // incident reported earlier and only resolved within the window.
            ...(filters.startDate || filters.endDate
                ? { updatedAt: { gte: filters.startDate, lte: filters.endDate } }
                : {}),
        };

        const [total, incidents] = await Promise.all([
            prisma.incident.count({ where }),
            prisma.incident.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    reporter: { select: { id: true, name: true } },
                    responders: { include: { responder: { select: { name: true } } } },
                },
            }),
        ]);

        return {
            records: incidents.map(shapeListItem),
            total,
            page,
            limit,
        };
    },

    async getById(id: string) {
        const incident = await prisma.incident.findUnique({
            where: { id },
            include: {
                reporter: { select: { id: true, name: true } },
                responders: { include: { responder: { select: { name: true } } } },
            },
        });
        if (!incident || !TERMINAL_STATUSES.includes(incident.status)) {
            throw new AppError("History record not found", 404);
        }

        const sosAlert = incident.sosAlertId
            ? await prisma.sosAlert.findUnique({ where: { id: incident.sosAlertId } })
            : null;

        return {
            ...shapeListItem(incident),
            details: incident.details,
            timeline: buildTimeline(incident),
            sosAlert: sosAlert && {
                id: sosAlert.id,
                latitude: sosAlert.latitude,
                longitude: sosAlert.longitude,
                createdAt: sosAlert.createdAt,
            },
        };
    },
};
