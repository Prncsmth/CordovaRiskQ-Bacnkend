import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { emitAdminActivity, emitEvacuationCenterUpdated } from "@/realtime/emit";
import { describeEvacuationCenterChange } from "@/services/adminAuditDetails";
import { AUDITED_TRANSACTION_OPTIONS, writeAdminAuditLog } from "@/services/adminAuditLog.service";

export const evacuationCenterService = {
    async list() {
        return prisma.evacuationCenter.findMany({
            orderBy: { name: "asc" },
        });
    },

    // The change and its audit row (who changed what) are saved together in
    // one transaction, so every update leaves its own row -- the Audit Logs
    // page no longer has to infer it from the center's updatedAt.
    async update(id: string, data: { status?: string; facilities?: string[] }, adminId: string) {
        const { updated, detail } = await prisma.$transaction(async (tx) => {
            const center = await tx.evacuationCenter.findUnique({ where: { id } });
            if (!center) throw new AppError("Evacuation center not found", 404);

            const updated = await tx.evacuationCenter.update({
                where: { id },
                data,
            });

            const detail = await writeAdminAuditLog(
                tx,
                adminId,
                "evacuation_center_updated",
                describeEvacuationCenterChange(center.name, center, updated),
                id,
            );
            return { updated, detail };
        }, AUDITED_TRANSACTION_OPTIONS);

        emitAdminActivity({
            type: "evacuation_center_updated",
            title: "Evacuation center updated",
            detail,
            occurredAt: updated.updatedAt.toISOString(),
        });
        emitEvacuationCenterUpdated({
            id: updated.id,
            status: updated.status,
            facilities: updated.facilities,
        });

        return updated;
    },
};
