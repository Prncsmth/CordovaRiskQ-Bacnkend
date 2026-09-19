import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { mergeRecentActivity, type AdminActivityItem } from "@/services/adminActivity";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NON_TERMINAL_STATUSES = ["pending", "lobby", "on_the_way", "arrived"];

export const adminService = {
    async listUsers(filters: {
        search?: string;
        role?: string;
        duty?: boolean;
        unit?: string;
        page?: number;
        limit?: number;
    }) {
        const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
        const limit =
            filters.limit && filters.limit > 0 ? Math.min(Math.floor(filters.limit), 100) : 20;

        const where = {
            ...(filters.role ? { role: filters.role } : {}),
            ...(filters.duty !== undefined ? { isOnDuty: filters.duty } : {}),
            ...(filters.unit === "unclassified"
                ? { unit: null }
                : filters.unit
                  ? { unit: filters.unit }
                  : {}),
            ...(filters.search
                ? {
                      OR: [
                          { name: { contains: filters.search, mode: "insensitive" as const } },
                          { email: { contains: filters.search, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        };

        const [total, newThisWeek, users] = await Promise.all([
            prisma.user.count({ where }),
            prisma.user.count({
                where: { ...where, createdAt: { gte: new Date(Date.now() - ONE_WEEK_MS) } },
            }),
            prisma.user.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            users: users.map((user) => ({
                id: user.id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                unit: user.unit,
                isOnDuty: user.isOnDuty,
                createdAt: user.createdAt,
            })),
            total,
            newThisWeek,
            page,
            limit,
        };
    },

    async getUserById(id: string) {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) throw new AppError("User not found", 404);

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            role: user.role,
            unit: user.unit,
            isOnDuty: user.isOnDuty,
            createdAt: user.createdAt,
        };
    },

    async listUserNames() {
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true },
            orderBy: { createdAt: "desc" },
        });

        return users.map((user) => ({ id: user.id, name: user.name ?? user.email }));
    },

    async updateUserRole(targetUserId: string, role: string, unit?: string | null) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (!target) throw new AppError("User not found", 404);
        if (target.role === "admin") {
            throw new AppError("Cannot change an admin's role", 403);
        }

        const updated = await prisma.user.update({
            where: { id: targetUserId },
            // unit only makes sense for responders -- clear it whenever the
            // target role isn't "responder" so a citizen never carries a
            // stale BDRRMO/MDRRMO classification from a prior promotion.
            data: { role, unit: role === "responder" ? unit : null },
        });

        return {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            unit: updated.unit,
            createdAt: updated.createdAt,
        };
    },

    async getResponderSummary() {
        const [total, onDuty, bdrrmo, mdrrmo] = await Promise.all([
            prisma.user.count({ where: { role: "responder" } }),
            prisma.user.count({ where: { role: "responder", isOnDuty: true } }),
            prisma.user.count({ where: { role: "responder", unit: "BDRRMO" } }),
            prisma.user.count({ where: { role: "responder", unit: "MDRRMO" } }),
        ]);

        return {
            total,
            onDuty,
            offDuty: total - onDuty,
            bdrrmo,
            mdrrmo,
            unclassified: total - bdrrmo - mdrrmo,
        };
    },

    // Live Map's responder layer -- only responders currently "on_the_way"
    // to a non-terminal incident have a fresh location at all (see
    // tracking.service.ts's updateResponderLocation gate + the mobile app's
    // useLiveLocationUpload, which only uploads in that phase). Idle
    // on-duty responders intentionally have no marker; this isn't a general
    // presence feed.
    async listEnRouteResponders() {
        const rows = await prisma.incidentResponder.findMany({
            where: {
                status: "on_the_way",
                incident: { status: { in: NON_TERMINAL_STATUSES } },
                responder: { latitude: { not: null }, longitude: { not: null } },
            },
            select: {
                incidentId: true,
                responder: {
                    select: { id: true, name: true, latitude: true, longitude: true, locationUpdatedAt: true },
                },
            },
        });

        return rows.map((row) => ({
            responderId: row.responder.id,
            responderName: row.responder.name ?? "Responder",
            incidentId: row.incidentId,
            latitude: row.responder.latitude as number,
            longitude: row.responder.longitude as number,
            locationUpdatedAt: row.responder.locationUpdatedAt,
        }));
    },

    // Derives the dashboard's Recent Activity feed (and the Audit Logs
    // page's fuller view of the same feed) from existing tables -- no
    // dedicated audit-log model. Each source is queried independently (most
    // recent `take`) and merged/sorted/capped by mergeRecentActivity. See
    // realtime/emit.ts's emitAdminActivity for the live-update counterpart
    // that covers everything after this initial load.
    async getRecentActivity(limit = 10) {
        const cappedLimit = Math.min(Math.max(limit, 1), 100);
        const take = cappedLimit;

        const [sosAlerts, joinedRows, resolvedIncidents, evacuationCenters, newUsers] = await Promise.all([
            prisma.sosAlert.findMany({
                orderBy: { createdAt: "desc" },
                take,
            }),
            prisma.incidentResponder.findMany({
                where: { status: "joined" },
                orderBy: { createdAt: "desc" },
                take,
                include: {
                    responder: { select: { name: true } },
                    incident: { select: { locationLabel: true } },
                },
            }),
            prisma.incident.findMany({
                where: { status: "completed" },
                orderBy: { updatedAt: "desc" },
                take,
            }),
            prisma.evacuationCenter.findMany({
                orderBy: { updatedAt: "desc" },
                take,
            }),
            prisma.user.findMany({
                orderBy: { createdAt: "desc" },
                take,
            }),
        ]);

        // SosAlert has no locationLabel of its own -- backfill it from the
        // linked Incident, same join sos.service.listForAdmin already does.
        const linkedIncidents = await prisma.incident.findMany({
            where: { sosAlertId: { in: sosAlerts.map((a) => a.id) } },
            select: { sosAlertId: true, locationLabel: true },
        });
        const locationBySosAlertId = new Map(
            linkedIncidents.map((i) => [i.sosAlertId as string, i.locationLabel]),
        );

        const items: AdminActivityItem[] = [
            ...sosAlerts.map((alert) => ({
                type: "sos_alert" as const,
                title: "New SOS alert received",
                detail: locationBySosAlertId.get(alert.id) ?? "Location unavailable",
                occurredAt: alert.createdAt.toISOString(),
            })),
            ...joinedRows.map((row) => ({
                type: "responder_joined" as const,
                title: `${row.responder.name ?? "A responder"} joined an incident`,
                detail: row.incident.locationLabel,
                occurredAt: row.createdAt.toISOString(),
            })),
            ...resolvedIncidents.map((incident) => ({
                type: "incident_resolved" as const,
                title: "Incident resolved",
                detail: incident.locationLabel,
                occurredAt: incident.updatedAt.toISOString(),
            })),
            ...evacuationCenters.map((center) => ({
                type: "evacuation_center_updated" as const,
                title: "Evacuation center updated",
                detail: center.name,
                occurredAt: center.updatedAt.toISOString(),
            })),
            ...newUsers.map((user) => ({
                type: "user_registered" as const,
                title: "New user registered",
                detail: user.name ?? user.email,
                occurredAt: user.createdAt.toISOString(),
            })),
        ];

        return mergeRecentActivity(items, cappedLimit);
    },
};
