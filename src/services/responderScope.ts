// src/services/responderScope.ts
// Which responders may act on (accept / decline / be paged for) an incident.
// One rule, applied server-side to the responder incident list, incident
// detail, the accept/decline endpoint and the new-incident alerts. It's
// tiered, so MDRRMO only hears about what actually needs them:
//
//   1. The BDRRMO responders assigned to the incident's barangay -- and
//      only them: a BDRRMO never gets another barangay's incident.
//   2. MDRRMO, as backup -- right away when that barangay has no on-duty
//      BDRRMO (or the incident can't be placed in a barangay), otherwise
//      once it escalates: still pending (nobody joined) ESCALATE_AFTER_MS
//      after it was created -- the admin's Unattended threshold.
//
// MDRRMO covers all of Cordova, so there's always someone above the
// barangay; opening an unanswered incident to other barangays' BDRRMO
// isn't needed. A BDRRMO without an assigned barangay, or a responder with
// no unit, gets nothing until the admin assigns them. The responder's unit and barangay always come
// from their User row, never the client. An incident's barangay is the
// nearest barangay center -- the same rule the responder app uses.
import { BARANGAY_CENTERS } from "@/constants/barangayCenters";
import { isActiveStatus, type ResponderRosterStatus } from "@/services/incidentRoster";
import { haversineDistanceKm } from "@/utils/geo";

// Matches the admin dashboard's UNATTENDED_THRESHOLD_MS.
export const ESCALATE_AFTER_MS = 2 * 60 * 1000;

export type ScopeResponder = {
    id: string;
    role: string;
    unit: string | null;
    assignedBarangay: string | null;
    isOnDuty: boolean;
};

// Lower-cased names of the barangays with at least one on-duty BDRRMO.
export type BarangayCoverage = Set<string>;

type IncidentLocation = { latitude: number | null; longitude: number | null };
export type ScopeIncident = IncidentLocation & { status: string; createdAt: Date };

const normalize = (name: string) => name.trim().toLowerCase();

export function incidentBarangayName(incident: IncidentLocation): string | null {
    const { latitude, longitude } = incident;
    if (latitude == null || longitude == null) return null;
    let nearest = BARANGAY_CENTERS[0];
    let nearestKm = Infinity;
    for (const center of BARANGAY_CENTERS) {
        const km = haversineDistanceKm({ latitude, longitude }, center);
        if (km < nearestKm) {
            nearest = center;
            nearestKm = km;
        }
    }
    return nearest.name;
}

export function coverageFrom(responders: ScopeResponder[]): BarangayCoverage {
    return new Set(
        responders
            .filter((r) => r.role === "responder" && r.isOnDuty && r.unit === "BDRRMO" && r.assignedBarangay)
            .map((r) => normalize(r.assignedBarangay as string)),
    );
}

// Tier 1: a BDRRMO responder assigned to the incident's barangay.
export function isAssignedBarangay(responder: ScopeResponder, incident: IncidentLocation): boolean {
    if (responder.role !== "responder" || responder.unit !== "BDRRMO" || !responder.assignedBarangay) return false;
    const barangay = incidentBarangayName(incident);
    return barangay !== null && normalize(responder.assignedBarangay) === normalize(barangay);
}

// The incident's barangay has an on-duty BDRRMO to handle it first.
export function hasBarangayCover(incident: IncidentLocation, coverage: BarangayCoverage): boolean {
    const barangay = incidentBarangayName(incident);
    return barangay !== null && coverage.has(normalize(barangay));
}

// Still pending, and nobody took it within ESCALATE_AFTER_MS.
export function isEscalated(incident: ScopeIncident, now = new Date()): boolean {
    return incident.status === "pending" && now.getTime() - incident.createdAt.getTime() >= ESCALATE_AFTER_MS;
}

export function canRespondToIncident(
    responder: ScopeResponder,
    incident: ScopeIncident,
    coverage: BarangayCoverage,
    now = new Date(),
): boolean {
    if (responder.role !== "responder") return false;
    if (isAssignedBarangay(responder, incident)) return true;
    if (responder.unit !== "MDRRMO") return false;
    return !hasBarangayCover(incident, coverage) || isEscalated(incident, now);
}

// For the app's note: an MDRRMO can act on it as backup -- the barangay
// has no on-duty BDRRMO, or nobody there took it in time.
export function isOpenAsBackup(
    responder: ScopeResponder,
    incident: ScopeIncident,
    coverage: BarangayCoverage,
    now = new Date(),
): boolean {
    return canRespondToIncident(responder, incident, coverage, now) && !isAssignedBarangay(responder, incident);
}

// Joining (accepting), declining, or rejoining after leaving needs scope.
// Someone already active on the roster may keep going or leave even if
// their assignment changed mid-incident -- otherwise they'd be stuck.
export function isResponseActionAllowed(
    currentStatus: ResponderRosterStatus | null,
    canRespond: boolean,
): boolean {
    if (currentStatus && isActiveStatus(currentStatus)) return true;
    return canRespond;
}

// The first alert, when the incident is created: the on-duty BDRRMO of its
// barangay -- or, if there are none, the on-duty MDRRMO.
export function selectNewIncidentRecipients(responders: ScopeResponder[], incident: IncidentLocation): string[] {
    const onDuty = responders.filter((r) => r.role === "responder" && r.isOnDuty);
    const assigned = onDuty.filter((r) => isAssignedBarangay(r, incident));
    if (assigned.length > 0) return assigned.map((r) => r.id);
    return onDuty.filter((r) => r.unit === "MDRRMO").map((r) => r.id);
}

// The escalation alert: every on-duty MDRRMO who hasn't already been
// alerted about it or put on its roster (e.g. declined).
export function selectEscalationRecipients(responders: ScopeResponder[], excludeIds: Set<string>): string[] {
    return responders
        .filter((r) => r.role === "responder" && r.isOnDuty && r.unit === "MDRRMO" && !excludeIds.has(r.id))
        .map((r) => r.id);
}
