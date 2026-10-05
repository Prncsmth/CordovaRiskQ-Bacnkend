// Which responders the citizen's Track Responder(s) screen shows, in what
// order. Pure so it's unit-tested without a database.
//
// Every responder currently helping (joined / on_the_way / arrived) -- not
// just the first to accept -- ordered by when they accepted. The order (and
// its id tiebreaker for an exact createdAt collision) matches
// pickAcceptedByResponderId, so the first entry is always the same
// responder the single-responder fields report, for app versions that only
// read those.
import { isActiveStatus, type ResponderRosterStatus } from "@/services/incidentRoster";

export type TrackingRosterRow = {
    id: string;
    responderId: string;
    status: ResponderRosterStatus;
    createdAt: Date;
};

// Roster statuses whose responder shares a live location: from the moment
// they accept (the app uploads from the lobby on) until they arrive. Must
// match the app's own upload window (responder IncidentDetailScreen's
// isSendingLiveLocation) -- the backend used to accept only "on_the_way",
// so responders who had joined but not yet headed out never had a
// location, and never got a marker on the citizen's map.
export const LOCATION_SHARING_STATUSES: ResponderRosterStatus[] = ["joined", "on_the_way"];

// A responder's saved location only counts for this incident if it was
// updated after they joined it -- otherwise it's their last position from
// an earlier incident and would put their marker in the wrong place.
export function locationForIncident<T extends { latitude: number | null; longitude: number | null; locationUpdatedAt: Date | null }>(
    user: T,
    joinedAt: Date,
): { latitude: number | null; longitude: number | null; locationUpdatedAt: Date | null } {
    const current =
        user.latitude !== null &&
        user.longitude !== null &&
        user.locationUpdatedAt !== null &&
        user.locationUpdatedAt.getTime() >= joinedAt.getTime();
    return current
        ? { latitude: user.latitude, longitude: user.longitude, locationUpdatedAt: user.locationUpdatedAt }
        : { latitude: null, longitude: null, locationUpdatedAt: null };
}

export function activeTrackingRoster<T extends TrackingRosterRow>(rows: T[]): T[] {
    return rows
        .filter((row) => isActiveStatus(row.status))
        .sort((a, b) => {
            const diff = a.createdAt.getTime() - b.createdAt.getTime();
            if (diff !== 0) return diff;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
}
