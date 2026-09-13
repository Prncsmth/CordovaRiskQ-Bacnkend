// src/services/incidentAuthorization.ts
// Pure authorization rule for "can this user see this incident's
// responder-facing detail (and, by extension, join its realtime room)".
// Mirrors incidentService.getById's citizen/reporter check -- extracted so
// both REST and the Socket.IO join:incident handler use the same rule
// instead of duplicating it. See
// docs/superpowers/specs/2026-09-08-active-incident-realtime-design.md.
export function canViewIncident(
    role: string | undefined,
    reporterId: string,
    requesterId: string,
): boolean {
    if (role === "citizen") return reporterId === requesterId;
    return true;
}

// A citizen can cancel their own report only while it's still "pending" --
// once a responder has joined (any later status), someone is already acting
// on it and a unilateral cancel would leave them dispatched with no signal.
// See docs/superpowers/specs/2026-09-14-sos-cancel-confirmation-design.md.
export function canCancelIncident(
    reporterId: string,
    requesterId: string,
    status: string,
): boolean {
    return reporterId === requesterId && status === "pending";
}
