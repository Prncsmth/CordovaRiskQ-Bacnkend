import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

export const announcementService = {
    async getActive(barangayName?: string) {
        const conditions: Array<Record<string, unknown>> = [{ audience: "All Users" }];

        if (barangayName) {
            conditions.push({
                audience: "Specific Barangay",
                barangayName: { equals: barangayName, mode: "insensitive" },
            });
        }

        return prisma.announcement.findFirst({
            where: { OR: conditions },
            orderBy: { createdAt: "desc" },
        });
    },

    async listForAdmin() {
        return prisma.announcement.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
        });
    },

    async create(
        createdByUserId: string,
        data: {
            title: string;
            content: string;
            priority: string;
            audience: string;
            barangayName?: string;
        }
    ) {
        return prisma.announcement.create({
            data: {
                title: data.title,
                content: data.content,
                priority: data.priority,
                audience: data.audience,
                barangayName: data.barangayName ?? null,
                createdByUserId,
            },
        });
    },

    async remove(id: string) {
        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new AppError("Announcement not found", 404);
        await prisma.announcement.delete({ where: { id } });
    },
};
