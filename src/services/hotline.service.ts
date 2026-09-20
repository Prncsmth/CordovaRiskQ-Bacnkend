import { prisma } from "@/lib/prisma";

export const hotlineService = {
    async list() {
        return prisma.hotline.findMany({
            orderBy: { name: "asc" },
        });
    },
};
