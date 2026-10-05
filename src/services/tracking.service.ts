import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { haversineDistanceKm } from "@/utils/geo";
import { pickAcceptedByResponderId, type ResponderRosterStatus } from "@/services/incidentRoster";
import { emitResponderLocationUpdate, emitAdminResponderLocation } from "@/realtime/emit";
import {
    activeTrackingRoster,
    LOCATION_SHARING_STATUSES,
    locationForIncident,
} from "@/services/trackingRoster";

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
    // Only writable while the caller is helping with at least one active
    // incident and hasn't arrived yet -- "joined" or "on_the_way" (see
    // LOCATION_SHARING_STATUSES), the same window the app uploads in. That
    // gate both starts eligibility (accepting) and stops it (arrived/left/
    // completed/cancelled all fall outside it), so no separate stop-condition
    // bookkeeping is needed. It used to be "on_the_way" only, which rejected
    // every upload from responders who had joined but not yet headed out --
    // so they never appeared on the citizen's map.
    async updateResponderLocation(responderId: string, data: { latitude: number; longitude: number }) {
        const sharingRows = await prisma.incidentResponder.findMany({
            where: {
                responderId,
                status: { in: LOCATION_SHARING_STATUSES },
                incident: { status: { in: NON_TERMINAL_STATUSES } },
            },
            select: { incidentId: true, status: true },
        });
        if (sharingRows.length === 0) {
            throw new AppError("Not currently responding to an incident", 403);
        }

        const locationUpdatedAt = new Date();
        const responder = await prisma.user.update({
            where: { id: responderId },
            data: { latitude: data.latitude, longitude: data.longitude, locationUpdatedAt },
        });

        for (const row of sharingRows) {
            // The incident's own room (the citizen's map) hears every
            // responder sharing a location.
            emitResponderLocationUpdate(row.incidentId, {
                responderId,
                latitude: data.latitude,
                longitude: data.longitude,
                locationUpdatedAt: locationUpdatedAt.toISOString(),
            });
            // The admin Live Map is specifically "responders en route"
            // (listEnRouteResponders), so it only hears on_the_way ones --
            // unchanged from before joined responders could share a location.
            if (row.status !== "on_the_way") continue;
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

        // Everyone currently helping, first-accepted first (see
        // trackingRoster.ts), with their user rows in one query.
        const roster = activeTrackingRoster(
            responderRows.map((r) => ({
                id: r.id,
                responderId: r.responderId,
                status: r.status as ResponderRosterStatus,
                createdAt: r.createdAt,
            })),
        );
        const users = await prisma.user.findMany({
            where: { id: { in: roster.map((r) => r.responderId) } },
            select: { id: true, name: true, latitude: true, longitude: true, locationUpdatedAt: true },
        });
        const usersById = new Map(users.map((u) => [u.id, u]));

        const responders = roster.flatMap((row) => {
            const user = usersById.get(row.responderId);
            if (!user) return [];
            // Only a location sent since joining this incident -- never a
            // leftover position from an earlier one.
            const location = locationForIncident(user, row.createdAt);
            return [
                {
                    responderId: user.id,
                    responderName: user.name ?? "Responder",
                    ...location,
                    status: row.status,
                    etaMinutes: estimateEtaMinutes(row.status, location, incident),
                },
            ];
        });

        const primary = responders.find((r) => r.responderId === acceptedByResponderId);
        if (!primary) throw new AppError("No responder has accepted this incident yet", 404);

        return {
            // The first-accepted responder, flat -- unchanged, for app
            // versions that only track one responder.
            ...primary,
            // Every responder currently helping (Track Responders).
            responders,
        };
    },
};
