import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";
import {
    activeAnnouncementConditions,
    findViewableAnnouncement,
} from "@/services/announcementAudience";
import { storedPriorityValues, withNormalizedPriority } from "@/services/announcementPriority";
import { resolveCurrentAnnouncement } from "@/services/announcementCurrent";
import { logAdminAction } from "@/services/adminAuditLog.service";
import { emitAnnouncementDeleted } from "@/realtime/emit";

export const announcementService = {
    // viewerRole is null for an anonymous caller. Responders Only
    // announcements are only returned to a responder (see
    // announcementAudience.canViewAnnouncement).
    // A soft-deleted row (deletedAt set) is treated exactly like one that
    // never existed -- findFirst with deletedAt: null instead of
    // findUnique(id) so that filter can apply (findUnique only accepts the
    // unique key itself).
    async getById(id: string, viewerRole: string | null) {
        const announcement = await findViewableAnnouncement(id, viewerRole, (announcementId) =>
            prisma.announcement.findFirst({
                where: { id: announcementId, deletedAt: null },
                include: { createdBy: { select: { name: true } } },
            })
        );
        if (!announcement) throw new AppError("Announcement not found", 404);
        return withNormalizedPriority(announcement);
    },

    // Newest first, regardless of severity: announcements have no expiry
    // yet, so ranking by severity would pin an old Critical alert above
    // every newer announcement indefinitely.
    //
    // Deliberately does NOT filter out deleted rows here -- it finds the
    // single newest-by-createdAt row matching audience, deleted or not, and
    // resolveCurrentAnnouncement decides whether that specific row counts
    // as current. Filtering deletedAt: null into the query instead would
    // just let the next-newest surviving row silently become "current"
    // again, the exact bug this exists to prevent.
    async getActive(barangayName?: string) {
        const latest = await prisma.announcement.findFirst({
            where: { OR: activeAnnouncementConditions({ barangayName }) },
            orderBy: { createdAt: "desc" },
        });
        return withNormalizedPriority(resolveCurrentAnnouncement(latest));
    },

    // The responder dashboard's card: newest of "All Users" and "Responders
    // Only". Served only behind authenticate + requireResponder. Same
    // never-fall-back-to-an-older-row reasoning as getActive above.
    async getActiveForResponder() {
        const latest = await prisma.announcement.findFirst({
            where: { OR: activeAnnouncementConditions({ includeRespondersOnly: true }) },
            orderBy: { createdAt: "desc" },
        });
        return withNormalizedPriority(resolveCurrentAnnouncement(latest));
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
            deletedAt: null,
            // A level also matches rows still stored under its old name.
            ...(filters.priority ? { priority: { in: storedPriorityValues(filters.priority) } } : {}),
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

        return {
            announcements: announcements.map((row) => withNormalizedPriority(row)),
            total,
            page,
            limit,
        };
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

        await logAdminAction(
            createdByUserId,
            "announcement_created",
            `Published "${announcement.title}" (${announcement.priority})`,
            announcement.id,
        );

        return withNormalizedPriority(announcement);
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
        },
        adminId: string,
    ) {
        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new AppError("Announcement not found", 404);

        const updated = await prisma.announcement.update({
            where: { id },
            data: {
                title: data.title,
                content: data.content,
                priority: data.priority,
                audience: data.audience,
                barangayName: data.barangayName ?? null,
            },
        });

        await logAdminAction(adminId, "announcement_updated", `Edited "${updated.title}"`, updated.id);

        return withNormalizedPriority(updated);
    },

    // Soft delete (sets deletedAt) instead of a real row delete -- getActive/
    // getActiveForResponder need the row to still exist afterward so they
    // can tell "the newest announcement was this one, and it's deleted"
    // apart from "the newest announcement is some older, undeleted one".
    //
    // Idempotent: a row already soft-deleted is treated the same as
    // "already achieved the caller's goal" rather than re-thrown as 404 or
    // re-processed -- a double-click or retried request doesn't re-log a
    // second audit entry or re-broadcast a second socket event for the same
    // delete. Only a truly nonexistent id (never created, or some other
    // record entirely) is a real 404.
    async remove(id: string, adminId: string) {
        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new AppError("Announcement not found", 404);
        if (existing.deletedAt !== null) return;

        await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
        await logAdminAction(adminId, "announcement_deleted", `Deleted "${existing.title}"`, id);
        emitAnnouncementDeleted({ id });
    },
};
