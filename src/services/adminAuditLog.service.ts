// src/services/adminAuditLog.service.ts
import { prisma } from "@/lib/prisma";

export type AdminAuditAction =
    | "announcement_created"
    | "announcement_updated"
    | "announcement_deleted"
    | "responder_barangay_updated"
    | "user_role_updated"
    | "support_request_status_updated";

// Best-effort: an audit-log write failing should never block the admin
// action it's recording (e.g. an announcement must still publish even if
// this insert fails). Logged, not thrown.
//
// The admin's name is resolved and baked into `detail` at write time (same
// "name — summary" shape as adminActivity.ts's supportRequestDetail)
// rather than looked up later -- an audit row is a historical snapshot, so
// it should keep reading correctly even if that admin's account name
// changes or is removed afterward.
export async function logAdminAction(
    adminId: string,
    action: AdminAuditAction,
    detail: string,
    targetId?: string,
): Promise<void> {
    try {
        const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { name: true } });
        await prisma.adminAuditLog.create({
            data: {
                adminId,
                action,
                detail: `${admin?.name ?? "An admin"} — ${detail}`,
                targetId: targetId ?? null,
            },
        });
    } catch (error) {
        console.error("Failed to write admin audit log:", error);
    }
}
