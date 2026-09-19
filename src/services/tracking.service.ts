import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { haversineDistanceKm } from "@/utils/geo";
import { pickAcceptedByResponderId, type ResponderRosterStatus } from "@/services/incidentRoster";
import { emitResponderLocationUpdate, emitAdminResponderLocation } from "@/realtime/emit";

const NON_TERMINAL_STATUSES = ["pending", "lobby", "on_the_way", "arrived"];

// Rough placeholder for a barangay/municipal road average -- not real
// routing (no Directions API wired up). Good enough for a ballpark ETA on
// the Track Responder screen; retune or replace once a routing provider is
// integrated.
const ASSUMED_AVERAGE_SPEED_KMH = 30;

function estimateEtaMinutes(
    responderStatus: string,
    responder: { latitude: number | null; longitude: number | null },
    incident: { latitude: number | null; longitude: number | null },
): number | null {
    if (responderStatus === "arrived") return null;
    if (responder.latitude === null || responder.longitude === null) return null;
    if (incident.latitude === null || incident.longitude === null) return null;

    const distanceKm = haversineDistanceKm(
        { latitude: responder.latitude, longitude: responder.longitude },
        { latitude: incident.latitude, longitude: incident.longitude },
    );
    return Math.round((distanceKm / ASSUMED_AVERAGE_SPEED_KMH) * 60);
}

export const trackingService = {
    // Only writable while the caller is currently "on_the_way" (En Route) on
    // at least one active incident -- this is the same gate that both starts
    // eligibility (a responder who has only "joined" isn't en route yet) and
    // stops it (arrived/completed/cancelled all fall off "on_the_way"), so no
    // separate stop-condition bookkeeping is needed.
    async updateResponderLocation(responderId: string, data: { latitude: number; longitude: number }) {
        const activeEnRouteRows = await prisma.incidentResponder.findMany({
            where: {
                responderId,
                status: "on_the_way",
                incident: { status: { in: NON_TERMINAL_STATUSES } },
            },
            select: { incidentId: true },
        });
        if (activeEnRouteRows.length === 0) {
            throw new AppError("Not currently en route to an incident", 403);
        }

        const locationUpdatedAt = new Date();
        const responder = await prisma.user.update({
            where: { id: responderId },
            data: { latitude: data.latitude, longitude: data.longitude, locationUpdatedAt },
        });

        for (const row of activeEnRouteRows) {
            emitResponderLocationUpdate(row.incidentId, {
                responderId,
                latitude: data.latitude,
                longitude: data.longitude,
                locationUpdatedAt: locationUpdatedAt.toISOString(),
            });
            emitAdminResponderLocation({
                responderId,
                responderName: responder.name ?? "Responder",
                incidentId: row.incidentId,
                latitude: data.latitude,
                longitude: data.longitude,
                locationUpdatedAt: locationUpdatedAt.toISOString(),
            });
        }
    },

    async getForIncident(incidentId: string, requesterId: string) {
        const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
        if (!incident) throw new AppError("Incident not found", 404);
        if (incident.reporterId !== requesterId) {
            throw new AppError("Not your report", 403);
        }
        if (!NON_TERMINAL_STATUSES.includes(incident.status)) {
            throw new AppError("Tracking is no longer available for this incident", 404);
        }

        const responderRows = await prisma.incidentResponder.findMany({
            where: { incidentId },
        });
        const acceptedByResponderId = pickAcceptedByResponderId(
            responderRows.map((r) => ({
                id: r.id,
                responderId: r.responderId,
                status: r.status as ResponderRosterStatus,
                createdAt: r.createdAt,
            })),
        );
        if (!acceptedByResponderId) {
            throw new AppError("No responder has accepted this incident yet", 404);
        }

        const myRow = responderRows.find((r) => r.responderId === acceptedByResponderId)!;
        const responder = await prisma.user.findUnique({ where: { id: acceptedByResponderId } });
        if (!responder) throw new AppError("No responder has accepted this incident yet", 404);

        return {
            responderId: responder.id,
            responderName: responder.name ?? "Responder",
            latitude: responder.latitude,
            longitude: responder.longitude,
            locationUpdatedAt: responder.locationUpdatedAt,
            status: myRow.status,
            etaMinutes: estimateEtaMinutes(myRow.status, responder, incident),
        };
    },
};
