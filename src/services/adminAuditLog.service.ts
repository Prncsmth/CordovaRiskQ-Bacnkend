// src/services/adminAuditLog.service.ts
import { prisma, type DbTransactionClient } from "@/lib/prisma";

export type AdminAuditAction =
    | "announcement_created"
    | "announcement_updated"
    | "announcement_deleted"
    | "responder_barangay_updated"
    | "user_role_updated"
    | "support_request_status_updated"
    | "evacuation_center_updated"
    | "hotline_updated"
    | "sos_alert_closed"
    | "admin_login"
    | "admin_profile_updated"
    | "admin_password_changed";

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
): Promise<string> {
    const admin = await client.user.findUnique({ where: { id: adminId }, select: { name: true } });
    const fullDetail = `${admin?.name ?? "An admin"} — ${detail}`;
    await client.adminAuditLog.create({
        data: {
            adminId,
            action,
            detail: fullDetail,
            targetId: targetId ?? null,
        },
    });
    // Returned so a live emitAdminActivity push can carry the same detail as
    // the row the Audit Logs page loads later (the admin app's read-state key).
    return fullDetail;
}

// For actions that can't share a transaction with their audit row (sign-in,
// and multi-step actions like closing an SOS alert): written after the
// action succeeds. A failed write never blocks or undoes the action -- an
// announcement must still publish, a sign-in must still work -- but it is
// retried once, and a write that still fails is logged loudly with the
// action and target, so a gap in the trail is never silent.
export async function logAdminAction(
    adminId: string,
    action: AdminAuditAction,
    detail: string,
    targetId?: string,
): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await writeAdminAuditLog(prisma, adminId, action, detail, targetId);
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
