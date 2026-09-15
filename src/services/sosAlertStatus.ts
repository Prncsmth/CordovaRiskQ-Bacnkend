// src/services/sosAlertStatus.ts
// Pure derivation of a SosAlert's admin-facing status bucket from its linked
// Incident's lifecycle status -- SosAlert.status itself never changes after
// creation (always "active"), so this is the real source of truth the
// frontend's New/Acknowledged/Resolved badge is built from. No Prisma --
// unit-tested directly. Mirrors the equivalent mapping already duplicated in
// cordova-riskq-admin's useSosAlerts.ts.

export type AlertStatus = "New" | "Acknowledged" | "Resolved";

const INCIDENT_STATUS_TO_ALERT_STATUS: Record<string, AlertStatus> = {
    pending: "New",
    lobby: "Acknowledged",
    on_the_way: "Acknowledged",
    arrived: "Acknowledged",
    completed: "Resolved",
    cancelled: "Resolved",
};

export function incidentStatusToAlertStatus(incidentStatus: string | undefined): AlertStatus {
    if (!incidentStatus) return "New";
    return INCIDENT_STATUS_TO_ALERT_STATUS[incidentStatus] ?? "New";
}

export function filterAlertIdsByStatus(
    allAlertIds: string[],
    incidentStatusByAlertId: Map<string, string>,
    alertStatus: AlertStatus,
): string[] {
    return allAlertIds.filter(
        (id) => incidentStatusToAlertStatus(incidentStatusByAlertId.get(id)) === alertStatus,
    );
}

export function countAlertsByStatus(
    allAlertIds: string[],
    incidentStatusByAlertId: Map<string, string>,
): { New: number; Acknowledged: number; Resolved: number; total: number } {
    const counts = { New: 0, Acknowledged: 0, Resolved: 0, total: allAlertIds.length };
    for (const id of allAlertIds) {
        counts[incidentStatusToAlertStatus(incidentStatusByAlertId.get(id))]++;
    }
    return counts;
}
