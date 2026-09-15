import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { mergeRecentActivity, type AdminActivityItem } from "@/services/adminActivity";

export const adminService = {
    async listUsers() {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
        });

        return users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            role: user.role,
            unit: user.unit,
            isOnDuty: user.isOnDuty,
            createdAt: user.createdAt,
        }));
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

    // Derives the dashboard's Recent Activity feed from existing tables --
    // no dedicated audit-log model. Each source is queried independently
    // (most recent 10) and merged/sorted/capped by mergeRecentActivity. See
    // realtime/emit.ts's emitAdminActivity for the live-update counterpart
    // that covers everything after this initial load.
    async getRecentActivity() {
        const [sosAlerts, joinedRows, resolvedIncidents, evacuationCenters, newUsers] = await Promise.all([
            prisma.sosAlert.findMany({
                orderBy: { createdAt: "desc" },
                take: 10,
            }),
            prisma.incidentResponder.findMany({
                where: { status: "joined" },
                orderBy: { createdAt: "desc" },
                take: 10,
                include: {
                    responder: { select: { name: true } },
                    incident: { select: { locationLabel: true } },
                },
            }),
            prisma.incident.findMany({
                where: { status: "completed" },
                orderBy: { updatedAt: "desc" },
                take: 10,
            }),
            prisma.evacuationCenter.findMany({
                orderBy: { updatedAt: "desc" },
                take: 10,
            }),
            prisma.user.findMany({
                orderBy: { createdAt: "desc" },
                take: 10,
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

        return mergeRecentActivity(items);
    },
};
