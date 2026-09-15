import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

export const evacuationCenterService = {
    async list() {
        return prisma.evacuationCenter.findMany({
            orderBy: { name: "asc" },
        });
    },

    async update(id: string, data: { status?: string; facilities?: string[] }) {
        const center = await prisma.evacuationCenter.findUnique({ where: { id } });
        if (!center) throw new AppError("Evacuation center not found", 404);

        return prisma.evacuationCenter.update({
            where: { id },
            data,
        });
    },
};
