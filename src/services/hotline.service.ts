import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { emitAdminAuditActivity, emitHotlineUpdated } from "@/realtime/emit";
import { describeHotlineChange } from "@/services/adminAuditDetails";
import { AUDITED_TRANSACTION_OPTIONS, writeAdminAuditLog } from "@/services/adminAuditLog.service";

export const hotlineService = {
    async list() {
        return prisma.hotline.findMany({
            orderBy: { name: "asc" },
        });
    },

    // The change and its audit row (old and new values) are saved together in
    // one transaction.
    async update(id: string, data: { name?: string; number?: string; category?: string }, adminId: string) {
        const { updated, activity } = await prisma.$transaction(async (tx) => {
            const existing = await tx.hotline.findUnique({ where: { id } });
            if (!existing) throw new AppError("Hotline not found", 404);

            const updated = await tx.hotline.update({
                where: { id },
                data,
            });

            const activity = await writeAdminAuditLog(tx, adminId, "hotline_updated", describeHotlineChange(existing, updated), id);
            return { updated, activity };
        }, AUDITED_TRANSACTION_OPTIONS);

        emitAdminAuditActivity(activity);
        emitHotlineUpdated({
            id: updated.id,
            name: updated.name,
            number: updated.number,
            category: updated.category,
        });

        return updated;
    },
};
