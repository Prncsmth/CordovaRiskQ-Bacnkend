// src/services/responderScope.ts
// Which responders may act on (accept / decline / be paged for) an incident.
// One rule, applied server-side to the responder incident list, incident
// detail, the accept/decline endpoint and new-incident push recipients:
//
//   - MDRRMO: anywhere in Cordova.
//   - BDRRMO with an assigned barangay: only incidents placed in it.
//   - BDRRMO without one, or a responder with no unit: none.
//   - An incident with no coordinates can't be placed, so MDRRMO only.
//
// Escalation, so no emergency goes unanswered: an incident still pending
// (nobody has joined) ESCALATE_AFTER_MS after it was created opens up to
// every responder -- the same 2 minutes after which the admin dashboard
// flags it Unattended. Until then only the responders in scope see it.
//
// The responder's unit and barangay always come from their User row, never
// from the client. An incident's barangay is the nearest barangay center --
// the same rule the responder app uses to group its dashboard.
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

// The responder's own territory: their barangay (BDRRMO) or all of Cordova
// (MDRRMO). Escalation aside.
export function isInScope(responder: ScopeResponder, incident: IncidentLocation): boolean {
    if (responder.role !== "responder") return false;
    if (responder.unit === "MDRRMO") return true;
    const barangay = incidentBarangayName(incident);
    if (responder.unit !== "BDRRMO" || !responder.assignedBarangay || !barangay) return false;
    return normalize(responder.assignedBarangay) === normalize(barangay);
}

// Still pending, and nobody in scope took it within ESCALATE_AFTER_MS.
export function isEscalated(incident: ScopeIncident, now = new Date()): boolean {
    return incident.status === "pending" && now.getTime() - incident.createdAt.getTime() >= ESCALATE_AFTER_MS;
}

export function canRespondToIncident(
    responder: ScopeResponder,
    incident: ScopeIncident,
    now = new Date(),
): boolean {
    if (responder.role !== "responder") return false;
    return isInScope(responder, incident) || isEscalated(incident, now);
}

// For the app's label: this responder can act on it only because it was
// escalated (it's outside their own territory).
export function isEscalatedFor(responder: ScopeResponder, incident: ScopeIncident, now = new Date()): boolean {
    return responder.role === "responder" && !isInScope(responder, incident) && isEscalated(incident, now);
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

// Who gets the new_incident alert when an incident is created: on-duty
// responders whose territory it's in.
export function selectNewIncidentRecipients(
    responders: ScopeResponder[],
    incident: IncidentLocation,
): string[] {
    return responders.filter((r) => r.isOnDuty && isInScope(r, incident)).map((r) => r.id);
}

// Who gets the escalation alert: the on-duty responders outside its
// territory (those inside already got the first alert), minus anyone who
// already has a roster row on it (e.g. declined).
export function selectEscalationRecipients(
    responders: ScopeResponder[],
    incident: IncidentLocation,
    excludeIds: Set<string>,
): string[] {
    return responders
        .filter((r) => r.role === "responder" && r.isOnDuty && !isInScope(r, incident) && !excludeIds.has(r.id))
        .map((r) => r.id);
}
