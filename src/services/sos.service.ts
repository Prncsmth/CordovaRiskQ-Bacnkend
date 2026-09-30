import { prisma, type DbTransactionClient } from "@/lib/prisma";
import type { Incident } from "@/generated/prisma/client";
import { incidentService, NON_TERMINAL_STATUSES } from "@/services/incident.service";
import { emitAdminActivity } from "@/realtime/emit";
import {
    type AdminCloseOutcome,
    type AlertStatus,
    adminCloseOutcomeToIncidentStatus,
    countAlertsByStatus,
    deriveAlertStatus,
    filterAlertIdsByStatus,
    incidentStatusToAlertOutcome,
} from "@/services/sosAlertStatus";
import { sosExpiryMs } from "@/lib/sosExpiryPolling";
import { AppError } from "@/utils/AppError";
import { type SosStore, type SosTriggerInput, triggerSos } from "@/services/sosTrigger";

function createSosStore(tx: DbTransactionClient): SosStore<Incident> {
    return {
        async findActive(userId) {
            const incident = await tx.incident.findFirst({
                where: {
                    reporterId: userId,
                    source: "sos",
                    sosAlertId: { not: null },
                    status: { in: NON_TERMINAL_STATUSES },
                },
                orderBy: { createdAt: "desc" },
                select: { id: true, sosAlertId: true },
            });
            if (!incident) return null;

            const alert = await tx.sosAlert.findUnique({
                where: { id: incident.sosAlertId as string },
                select: { id: true, status: true, createdAt: true },
            });
            return alert ? { alert, incidentId: incident.id } : null;
        },

        async create(userId, data) {
            const alert = await tx.sosAlert.create({
                data: {
                    userId,
                    latitude: data.latitude,
                    longitude: data.longitude,
                },
            });

            // Best-effort: the SOS record itself is the primary outcome and
            // must still succeed even if this mirror write fails. The
            // savepoint keeps a failed insert from aborting the surrounding
            // transaction (and with it the alert). incidentId stays null in
            // that case -- the frontend just won't be able to offer a cancel
            // action, since there's nothing to cancel.
            await tx.$executeRaw`SAVEPOINT sos_incident`;
            try {
                const incident = await incidentService.createFromSos(userId, alert.id, data, tx);
                await tx.$executeRaw`RELEASE SAVEPOINT sos_incident`;
                return { alert, incident };
            } catch (err) {
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT sos_incident`;
                console.error("Failed to create linked incident for SOS alert", alert.id, err);
                return { alert, incident: null };
            }
        },
    };
}

export type SosAlertAdminFilters = {
    status?: string;
    barangay?: string;
    search?: string;
    alertStatus?: AlertStatus;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
};

export const sosService = {
    // Idempotent per user: while the user's SOS incident is still active, a
    // repeat tap returns that same SOS (duplicate: true) instead of creating
    // another one and re-paging every responder. See sosTrigger.ts.
    trigger(userId: string, data: SosTriggerInput) {
        return triggerSos<Incident>(userId, data, {
            runExclusive: (lockUserId, work) =>
                prisma.$transaction(
                    async (tx) => {
                        // Serializes concurrent taps from the same user until
                        // commit; released automatically with the transaction.
                        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sos:${lockUserId}`}))`;
                        return work(createSosStore(tx));
                    },
                    // Generous limits so a burst of SOS queuing for pool
                    // connections doesn't fail on Prisma's 2s/5s defaults.
                    { maxWait: 10_000, timeout: 15_000 }
                ),
            announce: (alert, incident, input) => {
                emitAdminActivity({
                    type: "sos_alert",
                    title: "New SOS alert received",
                    // Same source GET /admin/activity reads (the linked
                    // incident's label, "SOS Alert" when no location was
                    // given) -- the admin panel keys read state on detail, so
                    // the two must match or a read alert returns unread.
                    detail: incident?.locationLabel ?? "Location unavailable",
                    occurredAt: alert.createdAt.toISOString(),
                });
                if (incident) incidentService.announceSosIncident(incident);
            },
            notifyResponders: (incident) => incidentService.notifyRespondersOfSos(incident),
        });
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
        }

        let searchAlertIds: string[] | undefined;
        if (filters.search) {
            const [byName, byLocation] = await Promise.all([
                prisma.sosAlert.findMany({
                    where: { user: { name: { contains: filters.search, mode: "insensitive" } } },
                    select: { id: true },
                }),
                prisma.incident.findMany({
                    where: {
                        sosAlertId: { not: null },
                        locationLabel: { contains: filters.search, mode: "insensitive" },
                    },
                    select: { sosAlertId: true },
                }),
            ]);
            searchAlertIds = Array.from(
                new Set([...byName.map((a) => a.id), ...byLocation.map((i) => i.sosAlertId as string)]),
            );
        }

        const now = new Date();
        const expiryMs = sosExpiryMs();

        let statusAlertIds: string[] | undefined;
        if (filters.alertStatus) {
            const [allAlerts, linkedIncidents] = await Promise.all([
                prisma.sosAlert.findMany({ select: { id: true, status: true, createdAt: true } }),
                prisma.incident.findMany({
                    where: { sosAlertId: { not: null } },
                    select: { sosAlertId: true, status: true },
                }),
            ]);
            const incidentStatusByAlertId = new Map(
                linkedIncidents.map((i) => [i.sosAlertId as string, i.status]),
            );
            statusAlertIds = filterAlertIdsByStatus(
                allAlerts,
                incidentStatusByAlertId,
                filters.alertStatus,
                now,
                expiryMs,
            );
        }

        // Multiple id-based filters (barangay/search/alertStatus) must
        // intersect (AND), not overwrite one another -- each narrows the
        // candidate set further.
        const idFilterSets = [barangayAlertIds, searchAlertIds, statusAlertIds].filter(
            (s): s is string[] => s !== undefined,
        );
        let combinedIds: string[] | undefined;
        if (idFilterSets.length > 0) {
            combinedIds = idFilterSets.reduce((acc, ids) => acc.filter((id) => ids.includes(id)));
            if (combinedIds.length === 0) {
                return { alerts: [], total: 0, page, limit };
            }
        }

        const where = {
            ...(filters.status ? { status: filters.status } : {}),
            ...(combinedIds ? { id: { in: combinedIds } } : {}),
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
                    alertStatus: deriveAlertStatus(alert, incident?.status, now, expiryMs),
                };
            }),
            total,
            page,
            limit,
        };
    },

    async getAdminSummary() {
        const [allAlerts, linkedIncidents] = await Promise.all([
            prisma.sosAlert.findMany({ select: { id: true, status: true, createdAt: true } }),
            prisma.incident.findMany({
                where: { sosAlertId: { not: null } },
                select: { sosAlertId: true, status: true },
            }),
        ]);
        const incidentStatusByAlertId = new Map(
            linkedIncidents.map((i) => [i.sosAlertId as string, i.status]),
        );
        return countAlertsByStatus(allAlerts, incidentStatusByAlertId, new Date(), sosExpiryMs());
    },

    async closeForAdmin(sosAlertId: string, outcome: AdminCloseOutcome) {
        const incidentStatus = adminCloseOutcomeToIncidentStatus(outcome);
        const linked = await prisma.incident.findFirst({ where: { sosAlertId }, select: { id: true } });

        if (linked) {
            const incident = await incidentService.closeSosByAdmin(sosAlertId, incidentStatus);
            return { id: sosAlertId, incidentId: incident.id, incidentStatus: incident.status };
        }

        // No incident to close (see sosAlertStatus.ts's ORPHAN_ALERT_STATUS) --
        // record the outcome on the alert itself. Only an alert with no outcome
        // yet ("active") can be closed.
        const { count } = await prisma.sosAlert.updateMany({
            where: { id: sosAlertId, status: "active" },
            data: { status: incidentStatusToAlertOutcome(incidentStatus) },
        });
        if (count === 0) {
            const exists = await prisma.sosAlert.findUnique({ where: { id: sosAlertId }, select: { id: true } });
            throw exists
                ? new AppError("This SOS alert is already closed", 409)
                : new AppError("SOS alert not found", 404);
        }
        return { id: sosAlertId, incidentId: null, incidentStatus: null };
    },
};
