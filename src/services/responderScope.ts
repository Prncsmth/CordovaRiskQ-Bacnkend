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
// Escalation, so no emergency goes unanswered: when nobody in scope is on
// duty for an incident (no on-duty MDRRMO and no on-duty BDRRMO assigned to
// its barangay), every on-duty responder may respond. It's recomputed on
// each request, so it ends as soon as someone in scope goes on duty.
//
// The responder's unit and barangay always come from their User row, never
// from the client. An incident's barangay is the nearest barangay center --
// the same rule the responder app uses to group its dashboard.
import { BARANGAY_CENTERS } from "@/constants/barangayCenters";
import { isActiveStatus, type ResponderRosterStatus } from "@/services/incidentRoster";
import { haversineDistanceKm } from "@/utils/geo";

export type ScopeResponder = {
    id: string;
    role: string;
    unit: string | null;
    assignedBarangay: string | null;
    isOnDuty: boolean;
};

export type ResponderCoverage = {
    // At least one on-duty MDRRMO responder exists.
    mdrrmoOnDuty: boolean;
    // Lower-cased barangay names with at least one on-duty BDRRMO assigned.
    bdrrmoOnDutyBarangays: Set<string>;
};

type IncidentLocation = { latitude: number | null; longitude: number | null };

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

function isInScope(responder: ScopeResponder, barangay: string | null): boolean {
    if (responder.role !== "responder") return false;
    if (responder.unit === "MDRRMO") return true;
    if (responder.unit !== "BDRRMO" || !responder.assignedBarangay || !barangay) return false;
    return normalize(responder.assignedBarangay) === normalize(barangay);
}

function isEscalated(barangay: string | null, coverage: ResponderCoverage): boolean {
    if (coverage.mdrrmoOnDuty) return false;
    return !barangay || !hasBdrrmoCover(coverage, barangay);
}

function hasBdrrmoCover(coverage: ResponderCoverage, barangay: string): boolean {
    for (const name of coverage.bdrrmoOnDutyBarangays) {
        if (normalize(name) === normalize(barangay)) return true;
    }
    return false;
}

export function canRespondToIncident(
    responder: ScopeResponder,
    incident: IncidentLocation,
    coverage: ResponderCoverage,
): boolean {
    if (responder.role !== "responder") return false;
    const barangay = incidentBarangayName(incident);
    return isInScope(responder, barangay) || isEscalated(barangay, coverage);
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

// Who gets the new_incident push / in-app notification: on-duty responders
// who can respond to it (everyone on duty when it's escalated).
export function selectNewIncidentRecipients(
    responders: ScopeResponder[],
    incident: IncidentLocation,
    coverage: ResponderCoverage,
): string[] {
    return responders
        .filter((r) => r.isOnDuty && canRespondToIncident(r, incident, coverage))
        .map((r) => r.id);
}

// Builds the coverage snapshot from the on-duty responders.
export function coverageFrom(responders: ScopeResponder[]): ResponderCoverage {
    const onDuty = responders.filter((r) => r.role === "responder" && r.isOnDuty);
    return {
        mdrrmoOnDuty: onDuty.some((r) => r.unit === "MDRRMO"),
        bdrrmoOnDutyBarangays: new Set(
            onDuty
                .filter((r) => r.unit === "BDRRMO" && r.assignedBarangay)
                .map((r) => normalize(r.assignedBarangay as string)),
        ),
    };
}
