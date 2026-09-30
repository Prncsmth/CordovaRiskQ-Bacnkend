// src/services/sosAlertStatus.ts
// Pure derivation of a SosAlert's admin-facing status bucket. The linked
// Incident's lifecycle status is the source of truth while that incident
// exists; SosAlert.status (always "active" at creation) only matters for an
// alert with no incident -- see ORPHAN_ALERT_STATUS. No Prisma -- unit-tested
// directly. Mirrors the equivalent mapping in cordova-riskq-admin's
// useSosAlerts.ts.

export type AlertStatus = "New" | "Acknowledged" | "Resolved" | "Cancelled" | "Unattended";

const INCIDENT_STATUS_TO_ALERT_STATUS: Record<string, AlertStatus> = {
    pending: "New",
    lobby: "Acknowledged",
    on_the_way: "Acknowledged",
    arrived: "Acknowledged",
    completed: "Resolved",
    // Was folded into "Resolved" -- a citizen who cancelled their own SOS
    // read on the admin dashboard as if a responder had actually resolved
    // it, indistinguishable from a genuinely handled alert.
    cancelled: "Cancelled",
    // Set by sosExpiryPolling.ts once a pending SOS goes unanswered past the
    // expiry window -- without it an ignored alert read as "New" forever.
    expired: "Unattended",
};

// An alert can have no incident: SOS sent before incidents were mirrored
// (pre 2026-08-20), a failed mirror write at trigger time, or a citizen
// deleting the closed incident from their history (removeOwnReport). The
// final outcome is then stamped onto SosAlert.status (by removeOwnReport and
// the admin close) so it survives; "active" means no outcome was recorded.
const ORPHAN_ALERT_STATUS: Record<string, AlertStatus> = {
    resolved: "Resolved",
    cancelled: "Cancelled",
    expired: "Unattended",
};

export type AlertForStatus = { id: string; status: string; createdAt: Date };

export function deriveAlertStatus(
    alert: Omit<AlertForStatus, "id">,
    incidentStatus: string | undefined,
    now: Date,
    expiryMs: number,
): AlertStatus {
    if (incidentStatus) return INCIDENT_STATUS_TO_ALERT_STATUS[incidentStatus] ?? "New";
    const stamped = ORPHAN_ALERT_STATUS[alert.status];
    if (stamped) return stamped;
    return now.getTime() - alert.createdAt.getTime() > expiryMs ? "Unattended" : "New";
}

// Final outcome to stamp on SosAlert.status when its incident is closed or
// about to be deleted, so deriveAlertStatus can still read it afterward.
export function incidentStatusToAlertOutcome(incidentStatus: string): string | undefined {
    if (incidentStatus === "completed") return "resolved";
    if (incidentStatus === "cancelled" || incidentStatus === "expired") return incidentStatus;
    return undefined;
}

// An admin may only close an SOS nobody has joined yet (New/Unattended) --
// once a responder is on it, closing stays the on-scene responder's call
// (incidentService.updateStatus) so an admin can't pull it out from under them.
const ADMIN_CLOSABLE_INCIDENT_STATUSES = ["pending", "expired"];

export function canAdminCloseSosIncident(incidentStatus: string): boolean {
    return ADMIN_CLOSABLE_INCIDENT_STATUSES.includes(incidentStatus);
}

export type AdminCloseOutcome = "resolved" | "dismissed";

export function adminCloseOutcomeToIncidentStatus(outcome: AdminCloseOutcome): "completed" | "cancelled" {
    return outcome === "resolved" ? "completed" : "cancelled";
}

export function filterAlertIdsByStatus(
    alerts: AlertForStatus[],
    incidentStatusByAlertId: Map<string, string>,
    alertStatus: AlertStatus,
    now: Date,
    expiryMs: number,
): string[] {
    return alerts
        .filter((a) => deriveAlertStatus(a, incidentStatusByAlertId.get(a.id), now, expiryMs) === alertStatus)
        .map((a) => a.id);
}

export function countAlertsByStatus(
    alerts: AlertForStatus[],
    incidentStatusByAlertId: Map<string, string>,
    now: Date,
    expiryMs: number,
): Record<AlertStatus, number> & { total: number } {
    const counts = {
        New: 0,
        Acknowledged: 0,
        Resolved: 0,
        Cancelled: 0,
        Unattended: 0,
        total: alerts.length,
    };
    for (const alert of alerts) {
        counts[deriveAlertStatus(alert, incidentStatusByAlertId.get(alert.id), now, expiryMs)]++;
    }
    return counts;
}
