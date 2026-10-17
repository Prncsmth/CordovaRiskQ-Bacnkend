// src/services/adminAuditLog.service.ts
import { prisma, type DbTransactionClient } from "@/lib/prisma";
import { emitAdminAuditActivity } from "@/realtime/emit";
import type { AdminActivityItem } from "@/services/adminActivity";

export type AdminAuditAction =
    | "announcement_created"
    | "announcement_updated"
    | "announcement_deleted"
    | "responder_barangay_updated"
    | "user_role_updated"
    | "support_request_status_updated"
    | "review_moderated"
    | "evacuation_center_updated"
    | "hotline_updated"
    | "sos_alert_closed"
    | "admin_login"
    | "admin_profile_updated"
    | "admin_password_changed";

// How each action reads in the activity feed (REST and live).
export const AUDIT_ACTION_TITLE: Record<AdminAuditAction, string> = {
    announcement_created: "Announcement published",
    announcement_updated: "Announcement edited",
    announcement_deleted: "Announcement deleted",
    responder_barangay_updated: "Responder barangay assigned",
    user_role_updated: "User role changed",
    support_request_status_updated: "Support request updated",
    review_moderated: "Review moderated",
    evacuation_center_updated: "Evacuation center updated",
    hotline_updated: "Hotline updated",
    sos_alert_closed: "SOS alert closed",
    admin_login: "Admin signed in",
    admin_profile_updated: "Admin profile updated",
    admin_password_changed: "Admin password changed",
};

// The prisma client or a transaction's client -- whatever the admin action
// itself is writing through.
type AuditClient = Pick<DbTransactionClient, "user" | "adminAuditLog">;

// Options for the prisma.$transaction that holds an admin change and its
// audit row: the same generous limits as sos.service.ts's trigger, since
// Prisma's 2s/5s defaults are too tight for Neon (e.g. a cold start).
export const AUDITED_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

// Writes one audit row and throws if it can't. Use it inside the same
// prisma.$transaction as the change it records, so the change and its audit
// row are saved together or not at all.
//
// The admin's name is resolved and baked into `detail` at write time (same
// "name — summary" shape as adminActivity.ts's supportRequestDetail)
// rather than looked up later -- an audit row is a historical snapshot, so
// it should keep reading correctly even if that admin's account name
// changes or is removed afterward. `detail` must never hold a password,
// code or token.
export async function writeAdminAuditLog(
    client: AuditClient,
    adminId: string,
    action: AdminAuditAction,
    detail: string,
    targetId?: string,
): Promise<AdminActivityItem> {
    const admin = await client.user.findUnique({ where: { id: adminId }, select: { name: true } });
    const fullDetail = `${admin?.name ?? "An admin"} — ${detail}`;
    const row = await client.adminAuditLog.create({
        data: {
            adminId,
            action,
            detail: fullDetail,
            targetId: targetId ?? null,
        },
    });
    // The row as the activity feed shows it. Push it live only once the
    // change is committed (emitAdminAuditActivity, or emitAdminActivity for
    // an action that also notifies every admin); its detail and time match
    // what the Audit Logs page loads later (the admin app's read-state key).
    return {
        type: action,
        title: AUDIT_ACTION_TITLE[action],
        detail: fullDetail,
        occurredAt: (row.createdAt ?? new Date()).toISOString(),
    };
}

// For actions that can't share a transaction with their audit row (sign-in,
// and multi-step actions like closing an SOS alert): written after the
// action succeeds. A failed write never blocks or undoes the action -- an
// announcement must still publish, a sign-in must still work -- but it is
// retried once, and a write that still fails is logged loudly with the
// action and target, so a gap in the trail is never silent. A saved row is
// pushed live to the admins' activity feed right away.
export async function logAdminAction(
    adminId: string,
    action: AdminAuditAction,
    detail: string,
    targetId?: string,
): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const activity = await writeAdminAuditLog(prisma, adminId, action, detail, targetId);
            emitAdminAuditActivity(activity);
            return;
        } catch (error) {
            if (attempt === 2) {
                console.error(
                    `AUDIT TRAIL GAP: could not record admin action "${action}" by ${adminId}` +
                        (targetId ? ` on ${targetId}` : "") +
                        ":",
                    error,
                );
            }
        }
    }
}
