import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";

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

    async listForAdmin(filters: {
        search?: string;
        priority?: string;
        page?: number;
        limit?: number;
    }) {
        const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
        const limit =
            filters.limit && filters.limit > 0 ? Math.min(Math.floor(filters.limit), 100) : 20;

        const where = {
            ...(filters.priority ? { priority: filters.priority } : {}),
            ...(filters.search
                ? {
                      OR: [
                          { title: { contains: filters.search, mode: "insensitive" as const } },
                          { content: { contains: filters.search, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        };

        const [total, announcements] = await Promise.all([
            prisma.announcement.count({ where }),
            prisma.announcement.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return { announcements, total, page, limit };
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
        const announcement = await prisma.announcement.create({
            data: {
                title: data.title,
                content: data.content,
                priority: data.priority,
                audience: data.audience,
                barangayName: data.barangayName ?? null,
                createdByUserId,
            },
        });

        if (data.audience === "All Users") {
            await notificationService.createForAllCitizens({
                type: "announcement",
                title: announcement.title,
                body: announcement.content,
            });
        }

        return announcement;
    },

    async remove(id: string) {
        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new AppError("Announcement not found", 404);
        await prisma.announcement.delete({ where: { id } });
    },
};
