import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { emitAdminActivity } from "@/realtime/emit";

export const evacuationCenterService = {
    async list() {
        return prisma.evacuationCenter.findMany({
            orderBy: { name: "asc" },
        });
    },

    async update(id: string, data: { status?: string; facilities?: string[] }) {
        const center = await prisma.evacuationCenter.findUnique({ where: { id } });
        if (!center) throw new AppError("Evacuation center not found", 404);

        const updated = await prisma.evacuationCenter.update({
            where: { id },
            data,
        });

        emitAdminActivity({
            type: "evacuation_center_updated",
            title: "Evacuation center updated",
            detail: updated.name,
            occurredAt: updated.updatedAt.toISOString(),
        });

        return updated;
    },
};
