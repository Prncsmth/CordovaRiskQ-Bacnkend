// src/services/adminActivity.ts
// Pure merge/sort/limit for the admin dashboard's Recent Activity feed. No
// Prisma -- unit-tested directly. See adminService.getRecentActivity for the
// Prisma queries that produce the raw items merged here, and
// realtime/emit.ts's emitAdminActivity for the live-update counterpart.

export type AdminActivityType =
    | "sos_alert"
    | "responder_joined"
    | "incident_resolved"
    | "evacuation_center_updated"
    | "user_registered";

export interface AdminActivityItem {
    type: AdminActivityType;
    title: string;
    detail: string;
    occurredAt: string;
}

export function mergeRecentActivity(
    items: AdminActivityItem[],
    limit = 10,
): AdminActivityItem[] {
    return [...items]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, limit);
}
