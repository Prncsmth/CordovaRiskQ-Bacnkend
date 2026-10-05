import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";
import {
    activeAnnouncementConditions,
    findViewableAnnouncement,
} from "@/services/announcementAudience";

export const announcementService = {
    // viewerRole is null for an anonymous caller. Responders Only
    // announcements are only returned to a responder (see
    // announcementAudience.canViewAnnouncement).
    async getById(id: string, viewerRole: string | null) {
        const announcement = await findViewableAnnouncement(id, viewerRole, (announcementId) =>
            prisma.announcement.findUnique({
                where: { id: announcementId },
                include: { createdBy: { select: { name: true } } },
            })
        );
        if (!announcement) throw new AppError("Announcement not found", 404);
        return announcement;
    },

    async getActive(barangayName?: string) {
        return prisma.announcement.findFirst({
            where: { OR: activeAnnouncementConditions({ barangayName }) },
            orderBy: { createdAt: "desc" },
        });
    },

    // The responder dashboard's card: newest of "All Users" and "Responders
    // Only". Served only behind authenticate + requireResponder.
    async getActiveForResponder() {
        return prisma.announcement.findFirst({
            where: { OR: activeAnnouncementConditions({ includeRespondersOnly: true }) },
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

        const notificationData = {
            type: "announcement" as const,
            title: announcement.title,
            body: announcement.content,
            referenceId: announcement.id,
        };

        if (data.audience === "All Users") {
            await notificationService.createForAllCitizens(notificationData);
            await notificationService.createForAllResponders(notificationData, {
                onDutyOnly: false,
            });
            await notificationService.createForAllAdmins(notificationData);
        } else if (data.audience === "Responders Only") {
            await notificationService.createForAllResponders(notificationData, {
                onDutyOnly: false,
            });
        } else if (data.audience === "Specific Barangay") {
            // No-op for now: User has no per-citizen barangay/location field to
            // filter by, so there's no accurate way to target this audience yet.
            // The announcement is still created and shown in-app.
            console.info(
                "Specific Barangay push skipped: User model has no barangay field yet."
            );
        }

        return announcement;
    },

    // Updates the announcement's own fields only -- deliberately doesn't
    // re-run create()'s notification fan-out, since an edit (e.g. fixing a
    // typo) re-pushing to every citizen/responder/admin again would be
    // spammy and surprising. The original publish notification already
    // reached its audience; editing the content afterward doesn't warrant
    // a second one.
    async update(
        id: string,
        data: {
            title: string;
            content: string;
            priority: string;
            audience: string;
            barangayName?: string;
        }
    ) {
        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new AppError("Announcement not found", 404);

        return prisma.announcement.update({
            where: { id },
            data: {
                title: data.title,
                content: data.content,
                priority: data.priority,
                audience: data.audience,
                barangayName: data.barangayName ?? null,
            },
        });
    },

    async remove(id: string) {
        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new AppError("Announcement not found", 404);
        await prisma.announcement.delete({ where: { id } });
    },
};
