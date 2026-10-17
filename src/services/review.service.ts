import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/services/adminAuditLog.service";
import { summarizeRatings } from "@/services/reviewSummary";
import { AppError } from "@/utils/AppError";

// Only what the public website shows -- never the review's status or anything else.
const PUBLIC_SELECT = { id: true, name: true, rating: true, title: true, comment: true, createdAt: true } as const;
const PUBLIC_LIMIT = 30;

export const reviewService = {
    async create(data: { name?: string; title?: string; rating: number; comment: string; website?: string }) {
        // Honeypot filled: answer like a normal submission, but store nothing.
        if (data.website && data.website.trim() !== "") return null;
        return prisma.review.create({
            data: {
                name: data.name ? data.name : null,
                rating: data.rating,
                title: data.title ? data.title : null,
                comment: data.comment,
            },
            select: { id: true, status: true, createdAt: true },
        });
    },

    // Approved reviews only, newest first, with the rating summary over all of them.
    async listPublic() {
        const [groups, reviews] = await Promise.all([
            prisma.review.groupBy({
                by: ["rating"],
                where: { status: "approved" },
                _count: { _all: true },
            }),
            prisma.review.findMany({
                where: { status: "approved" },
                orderBy: { createdAt: "desc" },
                take: PUBLIC_LIMIT,
                select: PUBLIC_SELECT,
            }),
        ]);
        const summary = summarizeRatings(groups.map((g) => ({ rating: g.rating, count: g._count._all })));
        return { summary, reviews };
    },

    async listForAdmin(filters: { status?: string; page?: number; limit?: number }) {
        const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
        const limit =
            filters.limit && filters.limit > 0 ? Math.min(Math.floor(filters.limit), 100) : 20;
        const where = filters.status ? { status: filters.status } : {};

        const [total, pendingCount, reviews] = await Promise.all([
            prisma.review.count({ where }),
            prisma.review.count({ where: { status: "pending" } }),
            prisma.review.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        return { reviews, total, pendingCount, page, limit };
    },

    async updateStatus(id: string, status: string, adminId: string) {
        const existing = await prisma.review.findUnique({ where: { id } });
        if (!existing) throw new AppError("Review not found", 404);
        const updated = await prisma.review.update({ where: { id }, data: { status } });

        await logAdminAction(
            adminId,
            "review_moderated",
            `Set ${updated.name || "Anonymous"}'s ${updated.rating}-star review to "${status}"`,
            updated.id,
        );
        return updated;
    },
};
