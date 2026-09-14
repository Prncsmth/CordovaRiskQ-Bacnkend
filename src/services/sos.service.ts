import { prisma } from "@/lib/prisma";
import { incidentService } from "@/services/incident.service";

export type SosAlertAdminFilters = {
    status?: string;
    barangay?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
};

export const sosService = {
    async trigger(
        userId: string,
        data: { latitude: number; longitude: number; locationLabel?: string }
    ) {
        const alert = await prisma.sosAlert.create({
            data: {
                userId,
                latitude: data.latitude,
                longitude: data.longitude,
            },
        });

        // Best-effort: the SOS record itself is the primary outcome and must
        // still succeed even if this mirror write fails. incidentId stays
        // null in that case -- the frontend just won't be able to offer a
        // cancel action, since there's nothing to cancel.
        let incidentId: string | null = null;
        try {
            const incident = await incidentService.createFromSos(userId, alert.id, data);
            incidentId = incident.id;
        } catch (err) {
            console.error(
                "Failed to create linked incident for SOS alert",
                alert.id,
                err
            );
        }

        return {
            id: alert.id,
            status: alert.status,
            createdAt: alert.createdAt,
            incidentId,
        };
    },

    // SosAlert itself has no barangay/location-label column (see trigger()
    // above) -- reuse the mirrored Incident's locationLabel instead of
    // duplicating that data onto SosAlert.
    async listForAdmin(filters: SosAlertAdminFilters) {
        const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
        const limit =
            filters.limit && filters.limit > 0 ? Math.min(Math.floor(filters.limit), 100) : 20;

        let barangayAlertIds: string[] | undefined;
        if (filters.barangay) {
            const matches = await prisma.incident.findMany({
                where: {
                    sosAlertId: { not: null },
                    locationLabel: { contains: filters.barangay, mode: "insensitive" },
                },
                select: { sosAlertId: true },
            });
            barangayAlertIds = matches.map((m) => m.sosAlertId as string);
            if (barangayAlertIds.length === 0) {
                return { alerts: [], total: 0, page, limit };
            }
        }

        const where = {
            ...(filters.status ? { status: filters.status } : {}),
            ...(barangayAlertIds ? { id: { in: barangayAlertIds } } : {}),
            ...(filters.startDate || filters.endDate
                ? { createdAt: { gte: filters.startDate, lte: filters.endDate } }
                : {}),
        };

        const [total, alerts] = await Promise.all([
            prisma.sosAlert.count({ where }),
            prisma.sosAlert.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: { user: { select: { name: true, mobile: true } } },
            }),
        ]);

        const linkedIncidents = await prisma.incident.findMany({
            where: { sosAlertId: { in: alerts.map((a) => a.id) } },
            select: { sosAlertId: true, id: true, locationLabel: true, status: true },
        });
        const incidentByAlertId = new Map(linkedIncidents.map((i) => [i.sosAlertId as string, i]));

        return {
            alerts: alerts.map((alert) => {
                const incident = incidentByAlertId.get(alert.id);
                return {
                    id: alert.id,
                    status: alert.status,
                    latitude: alert.latitude,
                    longitude: alert.longitude,
                    locationLabel: incident?.locationLabel ?? null,
                    createdAt: alert.createdAt,
                    reporter: { id: alert.userId, name: alert.user.name, mobile: alert.user.mobile },
                    incidentId: incident?.id ?? null,
                    incidentStatus: incident?.status ?? null,
                };
            }),
            total,
            page,
            limit,
        };
    },
};
