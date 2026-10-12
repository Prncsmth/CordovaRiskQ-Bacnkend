// src/services/notificationWindow.ts
// Admin and responder notifications are an operational inbox: each one is
// listed for 24 hours from when it was created -- read or not -- then drops
// out of the list and the unread count. Marking one read never changes when
// it expires. Filtered by createdAt on every GET, so an expired one can't
// come back after a refresh, a new session or a reconnect. Citizens keep
// their existing, unexpiring list.
import type { AdminActivityItem } from "@/services/adminActivity";

export const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const EXPIRING_ROLES = new Set(["admin", "responder"]);

// Oldest createdAt still listed for this role, or null for no cutoff.
export function notificationWindowStart(role: string | undefined, now = new Date()): Date | null {
    return role && EXPIRING_ROLES.has(role) ? new Date(now.getTime() - NOTIFICATION_TTL_MS) : null;
}

// A user may only read, mark or delete their own notification rows.
export function canAccessNotification(row: { userId: string } | null, userId: string): boolean {
    return row !== null && row.userId === userId;
}

// Each admin activity (new SOS, report, responder joined, ...) is saved as
// one Notification row per admin, so every admin's read state is their own
// and lives on the server rather than in one browser's storage. The type
// is the activity's own type, which the dashboard maps to an icon and link.
export function adminActivityNotification(activity: AdminActivityItem): {
    type: AdminActivityItem["type"];
    title: string;
    body: string;
} {
    return { type: activity.type, title: activity.title, body: activity.detail };
}
