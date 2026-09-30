// src/services/adminActivity.ts
// Pure merge/sort/limit for the admin dashboard's Recent Activity feed. No
// Prisma -- unit-tested directly. See adminService.getRecentActivity for the
// Prisma queries that produce the raw items merged here, and
// realtime/emit.ts's emitAdminActivity for the live-update counterpart.

export type AdminActivityType =
    | "sos_alert"
    | "incident_reported"
    | "responder_joined"
    | "incident_resolved"
    | "evacuation_center_updated"
    | "user_registered"
    | "support_request";

export interface AdminActivityItem {
    type: AdminActivityType;
    title: string;
    detail: string;
    occurredAt: string;
}

// One-line summary shared by the REST activity feed and the live
// emitAdminActivity push so both produce the same detail (and therefore the
// same read-state key on the admin frontend).
export function supportRequestDetail(
    subject: string | null,
    topic: string,
    userName: string | null,
): string {
    return `${userName ?? "A user"} — ${subject || `${topic} support request`}`;
}

export function mergeRecentActivity(
    items: AdminActivityItem[],
    limit = 10,
): AdminActivityItem[] {
    return [...items]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, limit);
}
