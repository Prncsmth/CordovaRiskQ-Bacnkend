// src/services/incidentRoster.ts
// Pure roster-transition and status-derivation rules for multi-responder
// incidents. No Prisma, no Express -- unit-tested directly. See
// docs/superpowers/specs/2026-09-08-multi-responder-incidents-design.md.

export type ResponderRosterStatus =
    | "joined"
    | "on_the_way"
    | "arrived"
    | "left"
    | "declined";

export type IncidentAggregateStatus = "pending" | "lobby" | "on_the_way" | "arrived";

const ACTIVE_STATUSES: ResponderRosterStatus[] = ["joined", "on_the_way", "arrived"];

export function isActiveStatus(status: ResponderRosterStatus): boolean {
    return ACTIVE_STATUSES.includes(status);
}

// Allowed (currentStatus | null) -> targetStatus transitions for a single
// responder's own IncidentResponder row. `null` currentStatus means the
// responder has no row yet for this incident.
export function isRosterTransitionAllowed(
    currentStatus: ResponderRosterStatus | null,
    targetStatus: ResponderRosterStatus,
): boolean {
    switch (targetStatus) {
        case "joined":
            return currentStatus === null || currentStatus === "left";
        case "declined":
            return currentStatus === null;
        case "on_the_way":
            return currentStatus === "joined" || currentStatus === "on_the_way";
        case "arrived":
            return currentStatus === "on_the_way" || currentStatus === "arrived";
        case "left":
            return (
                currentStatus === "joined" ||
                currentStatus === "on_the_way" ||
                currentStatus === "arrived"
            );
        default:
            return false;
    }
}

// Derives the citizen-facing aggregate Incident.status from the set of
// currently-active (joined/on_the_way/arrived) roster statuses for one
// incident. Highest-progress-wins; an empty set means nobody is helping.
export function deriveIncidentStatus(
    activeStatuses: ResponderRosterStatus[],
): IncidentAggregateStatus {
    if (activeStatuses.includes("arrived")) return "arrived";
    if (activeStatuses.includes("on_the_way")) return "on_the_way";
    if (activeStatuses.includes("joined")) return "lobby";
    return "pending";
}

// Picks the acceptedByResponderId-shaped value for backward compatibility
// with the Admin repo: the responder with the earliest createdAt among
// active-only rows (never left/declined), id as a deterministic tiebreaker
// for an exact createdAt collision. Returns null if nobody is active.
export function pickAcceptedByResponderId(
    rows: { id: string; responderId: string; status: ResponderRosterStatus; createdAt: Date }[],
): string | null {
    const active = rows.filter((r) => isActiveStatus(r.status));
    if (active.length === 0) return null;

    const earliest = [...active].sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        if (diff !== 0) return diff;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })[0];

    return earliest.responderId;
}
