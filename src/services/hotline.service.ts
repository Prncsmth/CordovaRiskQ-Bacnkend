import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { emitHotlineUpdated } from "@/realtime/emit";

export const hotlineService = {
    async list() {
        return prisma.hotline.findMany({
            orderBy: { name: "asc" },
        });
    },

    async update(id: string, data: { name?: string; number?: string; category?: string }) {
        const existing = await prisma.hotline.findUnique({ where: { id } });
        if (!existing) throw new AppError("Hotline not found", 404);

        const updated = await prisma.hotline.update({
            where: { id },
            data,
        });

        emitHotlineUpdated({
            id: updated.id,
            name: updated.name,
            number: updated.number,
            category: updated.category,
        });

        return updated;
    },
};
